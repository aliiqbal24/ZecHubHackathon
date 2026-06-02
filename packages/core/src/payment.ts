import { randomUUID } from "node:crypto";
import { assertLikelyZcashAddress } from "./address.js";
import { appendActivity, loadState, recordPayment, refreshWalletBalance, saveState } from "./state.js";
import { createAgentWalletAdapter, createWalletAdapter, waitForConfirmation } from "./wallet.js";
import { canApprovePurchase, evaluateGenericPaymentPolicy, evaluateQuotePolicy } from "./policy.js";
import { verifyReceipt } from "./receipt.js";
import { zecToZats, zatsToZec } from "./money.js";
import { applySafetyReadiness, buildAgentWalletSafetyReport } from "./safety.js";
import type { LocalPaymentReceipt, Purchase, ShippingProfile, ZecGuardConfig } from "./types.js";

const REAL_WALLET_BALANCE_MAX_AGE_MS = 5 * 60_000;

export interface ApproveAndPayOptions {
  purchaseId: string;
  overrideReason?: string;
  profileId?: string;
  approvedBy?: "dashboard" | "mcp";
}

export interface ApproveAndPayResult {
  ok: true;
  purchase: Purchase;
  payment: NonNullable<Purchase["payment"]>;
  confirmationPending?: boolean;
  localReceipt?: LocalPaymentReceipt;
}

export interface SweepAgentWalletResult {
  ok: true;
  payment: NonNullable<Purchase["payment"]>;
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

function refreshPolicy(purchase: Purchase, config: ZecGuardConfig, state: ReturnType<typeof loadState>) {
  if (purchase.source === "generic") {
    purchase.policy = evaluateGenericPaymentPolicy(
      {
        amountZec: purchase.amountZec,
        payTo: purchase.payTo,
        memo: purchase.memo,
        expiresAt: purchase.expiresAt,
        recipientLabel: purchase.vendorName
      },
      config,
      state
    );
  } else {
    purchase.policy = evaluateQuotePolicy(
      {
        quoteId: purchase.quoteId,
        vendorUrl: purchase.vendorUrl,
        vendorName: purchase.vendorName,
        itemId: purchase.itemId,
        itemTitle: purchase.itemTitle,
        amountZec: purchase.amountZec,
        expiresAt: purchase.expiresAt,
        terms: purchase.terms,
        requiredPii: purchase.requiredPii,
        fulfillmentType: purchase.fulfillmentType,
        privacy: purchase.privacy,
        memo: purchase.memo,
        payTo: purchase.payTo
      },
      config,
      state
    );
  }
}

export async function approveAndPayPurchase(
  config: ZecGuardConfig,
  options: ApproveAndPayOptions
): Promise<ApproveAndPayResult> {
  const state = loadState();
  const purchase = state.purchases.find((item) => item.id === options.purchaseId);

  if (!purchase) {
    throw new Error("Purchase not found.");
  }
  if (purchase.payment || ["payment_submitted", "pending_confirmation", "vendor_verified", "fulfilled", "receipted"].includes(purchase.status)) {
    throw new Error(`Purchase is already paid or in progress (${purchase.status}).`);
  }
  if (!canApprovePurchase(purchase) && purchase.status !== "policy_blocked") {
    throw new Error(`Purchase is ${purchase.status}, not approvable.`);
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
    throw new Error("Purchase expired.");
  }

  refreshPolicy(purchase, config, state);
  const blocked = purchase.policy.severity === "blocked";
  if (blocked && (!config.approval.allowOneTimeOverride || !options.overrideReason)) {
    saveState(state);
    throw new Error("Blocked purchases need a configured one-time override and an override reason.");
  }

  const agentWalletAdapter = createAgentWalletAdapter(config);
  if (config.agentWallet.backend === "zingo-cli") {
    await refreshWalletBalance(state, config);
    assertAgentWalletReady(state, purchase.amountZats);
    assertRealWalletSafetyReady(state, config);
  } else if (state.agentWallet.spendableZats < purchase.amountZats) {
    throw new Error(`Insufficient mock wallet balance: ${zatsToZec(state.agentWallet.spendableZats)} ZEC available, ${purchase.amountZec} ZEC needed.`);
  }

  const profile =
    config.shippingProfiles.find((item) => item.id === options.profileId) ?? config.shippingProfiles[0];
  const releasedPii = selectReleasedPii(purchase, profile);
  const payment = await agentWalletAdapter.sendPayment(purchase, state, config);
  const now = new Date().toISOString();

  if (config.agentWallet.backend === "mock") {
    state.agentWallet.balanceZats -= payment.amountZats;
    state.agentWallet.spendableZats -= payment.amountZats;
    state.agentWallet.balanceUpdatedAt = now;
  }
  purchase.status = "payment_submitted";
  purchase.approvedAt = now;
  purchase.updatedAt = now;
  purchase.approvalReason = options.overrideReason;
  purchase.releasedPii = releasedPii;
  purchase.payment = payment;
  recordPayment(state, {
    ...payment,
    purchaseId: purchase.id,
    orderId: purchase.orderId,
    vendorUrl: purchase.vendorUrl
  });
  appendActivity(state, {
    kind: "approval",
    title: options.approvedBy === "mcp" ? "MCP client approved payment" : "User approved payment",
    detail: `${purchase.amountZec} ZEC approved for ${purchase.vendorName}.`,
    purchaseId: purchase.id
  });
  appendActivity(state, {
    kind: "payment",
    title: "Payment submitted",
    detail: `${payment.txId} sent to ${purchase.payTo}.`,
    purchaseId: purchase.id
  });

  if (purchase.source === "generic") {
    const receipt: LocalPaymentReceipt = {
      receiptId: `lr_${randomUUID()}`,
      purchaseId: purchase.id,
      amountZec: purchase.amountZec,
      payTo: purchase.payTo,
      memo: purchase.memo,
      txId: payment.txId,
      paidAt: now,
      summary: `Local receipt for ${purchase.amountZec} ZEC sent to ${purchase.payTo}.`
    };
    purchase.status = "receipted";
    purchase.localReceipt = receipt;
    appendActivity(state, {
      kind: "receipt",
      title: "Local payment receipt stored",
      detail: receipt.summary,
      purchaseId: purchase.id
    });
    saveState(state);
    return { ok: true, purchase, payment, localReceipt: receipt };
  }

  saveState(state);

  if (config.agent.walletMode === "external-cli") {
    const adapter = createWalletAdapter(config);
    const minConf = config.verification?.minConfirmations ?? 1;
    const txInfo = await waitForConfirmation(adapter, payment.txId, minConf, 5, 10_000);
    if (txInfo.status !== "confirmed") {
      const updatedState = loadState();
      const updatedPurchase = updatedState.purchases.find((item) => item.id === options.purchaseId);
      if (updatedPurchase) {
        updatedPurchase.status = "pending_confirmation";
        updatedPurchase.updatedAt = new Date().toISOString();
        appendActivity(updatedState, {
          kind: "payment",
          title: "Transaction pending confirmation",
          detail: `${payment.txId} has ${txInfo.confirmations} confirmations (need ${minConf}).`,
          purchaseId: updatedPurchase.id
        });
        saveState(updatedState);
        return { ok: true, purchase: updatedPurchase, payment, confirmationPending: true };
      }
    }
  }

  const vendorResponse = await fetch(`${purchase.vendorUrl.replace(/\/$/, "")}/orders/${purchase.orderId}/verify`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ releasedPii, txId: payment.txId })
  });

  const updatedState = loadState();
  const updatedPurchase = updatedState.purchases.find((item) => item.id === options.purchaseId);
  if (!updatedPurchase) {
    throw new Error("Purchase disappeared after payment.");
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
    return { ok: true, purchase: updatedPurchase, payment, confirmationPending: true };
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
    throw new Error("Vendor verification failed.");
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

  return { ok: true, purchase: updatedPurchase, payment };
}

export async function sweepAgentWallet(config: ZecGuardConfig): Promise<SweepAgentWalletResult> {
  const state = loadState();
  const mainReturnAddress = assertLikelyZcashAddress(config.agentWallet.mainReturnAddress, "mainReturnAddress");
  if (config.agentWallet.backend === "zingo-cli" && !state.agentWallet.safety.returnAddressVerified) {
    throw new Error("Return address must be verified in the dashboard before sweeping the agent wallet.");
  }

  const adapter = createAgentWalletAdapter(config);
  if (config.agentWallet.backend === "zingo-cli") {
    await refreshWalletBalance(state, config);
    if (state.agentWallet.status !== "ready") {
      throw new Error(`Agent wallet is not ready for sweep (${state.agentWallet.status}).`);
    }
  }

  const payment = await adapter.sweepToMain(state, mainReturnAddress);
  const now = new Date().toISOString();
  state.agentWallet.balanceZats = Math.max(0, state.agentWallet.balanceZats - payment.amountZats);
  state.agentWallet.spendableZats = Math.max(0, state.agentWallet.spendableZats - payment.amountZats);
  state.agentWallet.balanceUpdatedAt = now;
  state.agentWallet.status = state.agentWallet.spendableZats > 0 ? "ready" : "waiting_for_funding";
  state.agentWallet.lastError = undefined;
  state.agentWallet.safety.smallTestSweepCompleted = true;
  state.agentWallet.safety.updatedAt = now;
  applySafetyReadiness(state.agentWallet.safety, state.agentWallet, config);
  appendActivity(state, {
    kind: "payment",
    title: "Agent wallet swept",
    detail: `${payment.amountZec} ZEC returned to main wallet.`
  });
  saveState(state);
  return { ok: true, payment };
}

function assertAgentWalletReady(state: ReturnType<typeof loadState>, amountZats: number): void {
  if (!state.agentWallet.depositAddress) {
    throw new Error("Agent wallet has not been created yet.");
  }
  if (state.agentWallet.status !== "ready") {
    const detail = state.agentWallet.lastError ? ` ${state.agentWallet.lastError}` : "";
    throw new Error(`Agent wallet is not ready (${state.agentWallet.status}).${detail}`);
  }
  const updatedAt = state.agentWallet.balanceUpdatedAt ? new Date(state.agentWallet.balanceUpdatedAt).getTime() : 0;
  if (!updatedAt || Date.now() - updatedAt > REAL_WALLET_BALANCE_MAX_AGE_MS) {
    throw new Error("Agent wallet balance is stale or unavailable. Refresh the wallet before approving payment.");
  }
  if (state.agentWallet.spendableZats < amountZats) {
    throw new Error(`Insufficient agent wallet balance: ${zatsToZec(state.agentWallet.spendableZats)} ZEC spendable, ${zatsToZec(amountZats)} ZEC needed.`);
  }
}

export function assertRealWalletSafetyReady(state: ReturnType<typeof loadState>, config: ZecGuardConfig): void {
  applySafetyReadiness(state.agentWallet.safety, state.agentWallet, config);
  const report = buildAgentWalletSafetyReport(state.agentWallet, config);
  if (state.agentWallet.spendableZats > zecToZats(config.agentWallet.maxRealWalletBalanceZec)) {
    throw new Error(`Agent wallet spendable balance exceeds the ${config.agentWallet.maxRealWalletBalanceZec} ZEC safety cap. Sweep excess funds before approving payments.`);
  }
  if (!report.readyForRealFunding) {
    throw new Error(`Agent wallet is not ready for real funding. Missing: ${report.blockers.join(", ")}.`);
  }
}

export function makeLocalPaymentPurchase(args: {
  amountZec: string;
  payTo: string;
  memo: string;
  recipientLabel?: string;
  expiresAt?: string;
  sourceUri?: string;
  config: ZecGuardConfig;
  state: ReturnType<typeof loadState>;
}): Purchase {
  const now = new Date().toISOString();
  const expiresAt = args.expiresAt ?? new Date(Date.now() + 15 * 60_000).toISOString();
  const quoteId = `generic_${randomUUID()}`;
  const policy = evaluateGenericPaymentPolicy(
    {
      amountZec: args.amountZec,
      payTo: args.payTo,
      memo: args.memo,
      expiresAt,
      recipientLabel: args.recipientLabel
    },
    args.config,
    args.state
  );

  return {
    id: `p_${randomUUID()}`,
    source: "generic",
    status: policy.severity === "blocked" ? "policy_blocked" : "awaiting_approval",
    createdAt: now,
    updatedAt: now,
    vendorUrl: args.sourceUri ?? "zcash:generic",
    vendorName: args.recipientLabel ?? "Generic ZEC recipient",
    itemId: "generic-zec-payment",
    itemTitle: "Generic ZEC payment",
    amountZec: args.amountZec,
    amountZats: zecToZats(args.amountZec),
    fulfillmentType: "service",
    terms: ["Generic ZEC payment. ZecGuard cannot automatically claim fulfillment without a compatible verification API."],
    requiredPii: [],
    privacy: {
      label: "Generic payment",
      grade: "medium",
      leaks: ["Recipient address", "Amount", "Memo"],
      summary: "ZecGuard can submit the payment and store a local receipt, but cannot verify merchant fulfillment."
    },
    policy,
    quoteId,
    orderId: `generic_order_${randomUUID()}`,
    payTo: args.payTo,
    memo: args.memo,
    expiresAt
  };
}
