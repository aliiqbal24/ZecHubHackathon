import fs from "node:fs";
import path from "node:path";
import {
  applyDirectTransferConfirmation,
  appendActivity,
  attachPaymentToVendorOrder,
  loadState,
  saveState
} from "./state.js";
import { getStatePath, loadConfig } from "./config.js";
import { verifyReceipt } from "./receipt.js";
import { createWalletAdapter, waitForConfirmation } from "./wallet.js";
import { canApprovePurchase } from "./policy.js";
import { zatsToZec } from "./money.js";
import type {
  AgentZcashConfig,
  AgentZcashState,
  PaymentRecord,
  Purchase,
  ShippingProfile
} from "./types.js";

const PAYMENT_LOCK_STALE_MS = 10 * 60 * 1000;

export type PaymentExecutorActor = "user" | "policy";

export interface ExecutePaymentOptions {
  actor: PaymentExecutorActor;
  profileId?: string;
  overrideReason?: string;
}

export type ExecutePaymentResult =
  | {
      ok: true;
      purchase: Purchase;
      alreadyProcessed?: boolean;
      confirmationPending?: boolean;
    }
  | {
      ok: false;
      error: string;
      status: number;
      purchase?: Purchase;
    };

export async function executePaymentWithLock(
  purchaseId: string,
  options: ExecutePaymentOptions
): Promise<ExecutePaymentResult> {
  const lock = acquirePaymentLock(purchaseId);
  if (!lock.acquired) {
    return { ok: false, error: "Payment approval is already being processed.", status: 409 };
  }

  try {
    return await executePayment(purchaseId, options);
  } finally {
    releasePaymentLock(lock.file);
  }
}

async function executePayment(purchaseId: string, options: ExecutePaymentOptions): Promise<ExecutePaymentResult> {
  const config = loadConfig();
  const state = loadState();
  const purchase = state.purchases.find((item) => item.id === purchaseId);

  if (!purchase) {
    return { ok: false, error: "Purchase not found", status: 404 };
  }
  if (purchase.payment || ["payment_submitted", "pending_confirmation", "receipted"].includes(purchase.status)) {
    return { ok: true, purchase, alreadyProcessed: true };
  }
  if (purchase.status === "approved") {
    return { ok: false, error: "Payment approval is already being processed.", status: 409, purchase };
  }
  if (purchase.kind === "direct_transfer" && purchase.policy.severity === "blocked") {
    return { ok: false, error: "Blocked direct transfers cannot be approved.", status: 409, purchase };
  }
  if (!canApprovePurchase(purchase) && purchase.status !== "policy_blocked") {
    return { ok: false, error: `Purchase is ${purchase.status}, not approvable`, status: 409, purchase };
  }
  if (options.actor === "policy" && (purchase.policy.requiresApproval || purchase.policy.severity !== "pass")) {
    return { ok: false, error: "Policy requires dashboard approval.", status: 409, purchase };
  }
  if (new Date(purchase.expiresAt).getTime() < Date.now()) {
    purchase.status = "expired";
    purchase.updatedAt = new Date().toISOString();
    appendActivity(state, {
      kind: "approval",
      title: "Approval expired",
      detail: `${purchase.itemTitle} quote expired before approval.`,
      purchaseId: purchase.id
    });
    saveState(state);
    return { ok: false, error: "Quote expired", status: 409, purchase };
  }
  if (purchase.policy.severity === "blocked") {
    if (!config.approval.allowOneTimeOverride) {
      return { ok: false, error: "Blocked purchases cannot be approved by current policy.", status: 409, purchase };
    }
    if (!options.overrideReason) {
      return { ok: false, error: "Blocked purchases need an override reason", status: 409, purchase };
    }
  }

  const approvalStartedAt = new Date().toISOString();
  purchase.status = "approved";
  purchase.approvedAt = approvalStartedAt;
  purchase.updatedAt = approvalStartedAt;
  purchase.approvalReason = options.overrideReason;
  appendActivity(state, {
    kind: "approval",
    title: options.actor === "policy" ? "Policy approved autonomous payment" : "User approved payment",
    detail:
      options.actor === "policy"
        ? `${purchase.amountZec} ZEC auto-approved for ${purchase.vendorName}.`
        : `${purchase.amountZec} ZEC approved for ${purchase.vendorName}.`,
    purchaseId: purchase.id
  });
  saveState(state);

  const adapter = createWalletAdapter(config);
  try {
    const liveBalance = await adapter.getBalance();
    if (liveBalance < purchase.amountZats) {
      purchase.status = "payment_failed";
      purchase.updatedAt = new Date().toISOString();
      appendActivity(state, {
        kind: "payment",
        title: "Payment failed",
        detail: `Insufficient wallet balance: ${zatsToZec(liveBalance)} ZEC available, ${purchase.amountZec} ZEC needed.`,
        purchaseId: purchase.id
      });
      saveState(state);
      return {
        ok: false,
        error: `Insufficient wallet balance: ${zatsToZec(liveBalance)} ZEC available, ${purchase.amountZec} ZEC needed.`,
        status: 402,
        purchase
      };
    }
  } catch (err) {
    purchase.status = "payment_failed";
    purchase.updatedAt = new Date().toISOString();
    appendActivity(state, {
      kind: "payment",
      title: "Payment failed",
      detail: `Could not check wallet balance: ${err instanceof Error ? err.message : String(err)}`,
      purchaseId: purchase.id
    });
    saveState(state);
    return {
      ok: false,
      error: `Could not check wallet balance: ${err instanceof Error ? err.message : String(err)}`,
      status: 502,
      purchase
    };
  }

  const profile = config.shippingProfiles.find((item) => item.id === options.profileId) ?? config.shippingProfiles[0];
  const releasedPii = selectReleasedPii(purchase, profile);
  let payment: PaymentRecord;
  try {
    payment = await adapter.sendPayment(purchase, state, config);
  } catch (err) {
    purchase.status = "payment_failed";
    purchase.updatedAt = new Date().toISOString();
    appendActivity(state, {
      kind: "payment",
      title: "Payment failed",
      detail: err instanceof Error ? err.message : String(err),
      purchaseId: purchase.id
    });
    saveState(state);
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Payment failed",
      status: 502,
      purchase
    };
  }

  const now = new Date().toISOString();
  purchase.status = "payment_submitted";
  purchase.updatedAt = now;
  purchase.releasedPii = releasedPii;
  purchase.payment = payment;
  attachPaymentToVendorOrder(state, purchase.orderId, payment);
  appendActivity(state, {
    kind: "payment",
    title: "Payment submitted",
    detail: purchase.kind === "direct_transfer" ? `${payment.txId} submitted to wallet.` : `${payment.txId} sent to vendor harness.`,
    purchaseId: purchase.id
  });

  if (purchase.kind === "direct_transfer" && purchase.directTransfer) {
    return await finalizeDirectTransfer(state, config, purchase, payment);
  }

  return await finalizeVendorPurchase(state, config, purchase, payment, releasedPii);
}

async function finalizeDirectTransfer(
  state: AgentZcashState,
  config: AgentZcashConfig,
  purchase: Purchase,
  payment: PaymentRecord
): Promise<ExecutePaymentResult> {
  if (!purchase.directTransfer) {
    return { ok: false, error: "Direct transfer details missing", status: 500, purchase };
  }

  const now = new Date().toISOString();
  purchase.status = "pending_confirmation";
  purchase.paymentReceipt = {
    receiptId: `receipt_${purchase.id}`,
    kind: "direct_transfer",
    recipientName: purchase.directTransfer.recipientName,
    payTo: purchase.payTo,
    amountZec: purchase.amountZec,
    memo: purchase.memo,
    purpose: purchase.directTransfer.purpose,
    evidenceUrls: purchase.directTransfer.evidenceUrls,
    txId: payment.txId,
    submittedAt: payment.submittedAt,
    summary: `${purchase.amountZec} ZEC submitted to ${purchase.directTransfer.recipientName}.`,
    confirmationStatus: "pending",
    confirmations: 0,
    lastCheckedAt: now
  };
  saveState(state);

  const minConf = config.verification?.minConfirmations ?? 1;
  const adapter = createWalletAdapter(config);
  const txInfo = await waitForConfirmation(adapter, payment.txId, minConf, 5, 10_000);
  const updatedState = loadState();
  const updatedPurchase = updatedState.purchases.find((item) => item.id === purchase.id);
  if (!updatedPurchase) {
    return { ok: false, error: "Purchase disappeared after payment", status: 500 };
  }

  applyDirectTransferConfirmation(updatedState, updatedPurchase, txInfo, minConf);
  if (updatedPurchase.status === "pending_confirmation") {
    appendActivity(updatedState, {
      kind: "payment",
      title: "Direct transfer pending confirmation",
      detail: `${payment.txId} has ${txInfo.confirmations} confirmations (need ${minConf}).`,
      purchaseId: updatedPurchase.id
    });
  }
  saveState(updatedState);
  return {
    ok: true,
    purchase: updatedPurchase,
    confirmationPending: updatedPurchase.status === "pending_confirmation"
  };
}

async function finalizeVendorPurchase(
  state: AgentZcashState,
  config: AgentZcashConfig,
  purchase: Purchase,
  payment: PaymentRecord,
  releasedPii: Record<string, unknown> | undefined
): Promise<ExecutePaymentResult> {
  saveState(state);

  const minConf = config.verification?.minConfirmations ?? 1;
  const adapter = createWalletAdapter(config);
  const txInfo = await waitForConfirmation(adapter, payment.txId, minConf, 5, 10_000);
  if (txInfo.status !== "confirmed") {
    const updatedState = loadState();
    const updatedPurchase = updatedState.purchases.find((item) => item.id === purchase.id);
    if (updatedPurchase) {
      appendActivity(updatedState, {
        kind: "payment",
        title: "Transaction pending confirmation",
        detail: `${payment.txId} has ${txInfo.confirmations} confirmations (need ${minConf}).`,
        purchaseId: purchase.id
      });
      saveState(updatedState);
    }
  }

  const vendorResponse = await fetch(`${purchase.vendorUrl.replace(/\/$/, "")}/orders/${purchase.orderId}/verify`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ releasedPii, txId: payment.txId })
  });

  const updatedState = loadState();
  const updatedPurchase = updatedState.purchases.find((item) => item.id === purchase.id);
  if (!updatedPurchase) {
    return { ok: false, error: "Purchase disappeared after payment", status: 500 };
  }

  if (vendorResponse.status === 202) {
    updatedPurchase.status = "pending_confirmation";
    updatedPurchase.updatedAt = new Date().toISOString();
    appendActivity(updatedState, {
      kind: "vendor",
      title: "Payment pending confirmation",
      detail: "Vendor is waiting for on-chain confirmation.",
      purchaseId: updatedPurchase.id
    });
    saveState(updatedState);
    return { ok: true, purchase: updatedPurchase, confirmationPending: true };
  }

  if (!vendorResponse.ok) {
    updatedPurchase.status = "verification_failed";
    updatedPurchase.updatedAt = new Date().toISOString();
    appendActivity(updatedState, {
      kind: "vendor",
      title: "Vendor verification failed",
      detail: `Vendor returned ${vendorResponse.status}.`,
      purchaseId: updatedPurchase.id
    });
    saveState(updatedState);
    return { ok: false, error: "Vendor verification failed", status: 502, purchase: updatedPurchase };
  }

  const vendorResult = (await vendorResponse.json()) as {
    fulfillment?: Purchase["fulfillment"];
    receipt?: Purchase["receipt"];
  };
  updatedPurchase.status = "receipted";
  updatedPurchase.fulfillment = vendorResult.fulfillment;
  updatedPurchase.receipt = vendorResult.receipt;
  updatedPurchase.updatedAt = new Date().toISOString();
  appendActivity(updatedState, {
    kind: "receipt",
    title: vendorResult.receipt && verifyReceipt(vendorResult.receipt) ? "Private receipt verified" : "Receipt stored",
    detail: vendorResult.receipt?.summary ?? "Vendor returned fulfillment.",
    purchaseId: updatedPurchase.id
  });
  saveState(updatedState);

  return { ok: true, purchase: updatedPurchase };
}

function selectReleasedPii(purchase: Purchase, profile?: ShippingProfile): Record<string, unknown> | undefined {
  if (purchase.requiredPii.length === 0) return undefined;
  if (!profile) return undefined;

  return Object.fromEntries(
    purchase.requiredPii
      .map((field) => [field, profile[field as keyof ShippingProfile]])
      .filter(([, value]) => value !== undefined && value !== "")
  );
}

function acquirePaymentLock(purchaseId: string): { acquired: true; file: string } | { acquired: false; file: string } {
  const dir = path.join(path.dirname(getStatePath()), "locks");
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `approval-${safeLockName(purchaseId)}.lock`);

  try {
    return openPaymentLock(file);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") {
      throw error;
    }
  }

  if (isStalePaymentLock(file)) {
    fs.rmSync(file, { force: true });
    try {
      return openPaymentLock(file);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") {
        throw error;
      }
    }
  }

  return { acquired: false, file };
}

function openPaymentLock(file: string): { acquired: true; file: string } {
  const fd = fs.openSync(file, "wx");
  fs.writeFileSync(fd, JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }));
  fs.closeSync(fd);
  return { acquired: true, file };
}

function releasePaymentLock(file: string): void {
  fs.rmSync(file, { force: true });
}

function isStalePaymentLock(file: string): boolean {
  try {
    const stat = fs.statSync(file);
    return Date.now() - stat.mtimeMs > PAYMENT_LOCK_STALE_MS;
  } catch {
    return false;
  }
}

function safeLockName(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 120) || "unknown";
}
