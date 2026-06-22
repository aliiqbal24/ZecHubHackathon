import { createHash, timingSafeEqual } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { NextRequest, NextResponse } from "next/server";
import {
  appendActivity,
  applyDirectTransferConfirmation,
  canApprovePurchase,
  createWalletAdapter,
  getStatePath,
  loadConfig,
  loadState,
  saveState,
  verifyReceipt,
  waitForConfirmation,
  zatsToZec,
  type PaymentRecord,
  type Purchase,
  type ShippingProfile
} from "@agentzcash/core";

export const dynamic = "force-dynamic";

const APPROVAL_LOCK_STALE_MS = 10 * 60 * 1000;

interface ApprovalRequestBody {
  profileId?: string;
  overrideReason?: string;
  approvalToken?: string;
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

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = (await request.json().catch(() => ({}))) as ApprovalRequestBody;
  const lock = acquireApprovalLock(id);
  if (!lock.acquired) {
    return NextResponse.json({ error: "Payment approval is already being processed." }, { status: 409 });
  }

  try {
    return await approveWithLock(request, id, body);
  } finally {
    releaseApprovalLock(lock.file);
  }
}

async function approveWithLock(request: NextRequest, id: string, body: ApprovalRequestBody) {
  const config = loadConfig();
  const state = loadState();
  const purchase = state.purchases.find((item) => item.id === id);

  if (!purchase) {
    return NextResponse.json({ error: "Purchase not found" }, { status: 404 });
  }

  const requestSafety = validateLocalApprovalRequest(request);
  if (!requestSafety.ok) {
    return NextResponse.json({ error: requestSafety.error }, { status: 403 });
  }
  if (!validateApprovalToken(purchase.approvalTokenHash, body.approvalToken)) {
    return NextResponse.json({ error: "Open the AgentZcash approval URL before approving this payment." }, { status: 403 });
  }

  if (purchase.payment || ["payment_submitted", "pending_confirmation", "receipted"].includes(purchase.status)) {
    return NextResponse.json({ ok: true, purchase, alreadyProcessed: true });
  }
  if (purchase.status === "approved") {
    return NextResponse.json({ error: "Payment approval is already being processed." }, { status: 409 });
  }
  if (purchase.kind === "direct_transfer" && purchase.policy.severity === "blocked") {
    return NextResponse.json({ error: "Blocked direct transfers cannot be approved." }, { status: 409 });
  }
  if (!canApprovePurchase(purchase) && purchase.status !== "policy_blocked") {
    return NextResponse.json({ error: `Purchase is ${purchase.status}, not approvable` }, { status: 409 });
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
    return NextResponse.json({ error: "Quote expired" }, { status: 409 });
  }
  if (purchase.policy.severity === "blocked" && !body.overrideReason) {
    return NextResponse.json({ error: "Blocked purchases need an override reason" }, { status: 409 });
  }

  const approvalStartedAt = new Date().toISOString();
  purchase.status = "approved";
  purchase.approvedAt = approvalStartedAt;
  purchase.updatedAt = approvalStartedAt;
  purchase.approvalReason = body.overrideReason;
  appendActivity(state, {
    kind: "approval",
    title: "User approved payment",
    detail: `${purchase.amountZec} ZEC approved for ${purchase.vendorName}.`,
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
      return NextResponse.json(
        { error: `Insufficient wallet balance: ${zatsToZec(liveBalance)} ZEC available, ${purchase.amountZec} ZEC needed.` },
        { status: 402 }
      );
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
    return NextResponse.json(
      { error: `Could not check wallet balance: ${err instanceof Error ? err.message : String(err)}` },
      { status: 502 }
    );
  }

  const profile =
    config.shippingProfiles.find((item) => item.id === body.profileId) ?? config.shippingProfiles[0];
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
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Payment failed" },
      { status: 502 }
    );
  }
  const now = new Date().toISOString();

  purchase.status = "payment_submitted";
  purchase.updatedAt = now;
  purchase.releasedPii = releasedPii;
  purchase.payment = payment;
  appendActivity(state, {
    kind: "payment",
    title: "Payment submitted",
    detail: purchase.kind === "direct_transfer" ? `${payment.txId} submitted to wallet.` : `${payment.txId} sent to vendor harness.`,
    purchaseId: purchase.id
  });

  if (purchase.kind === "direct_transfer" && purchase.directTransfer) {
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
    const txInfo = await waitForConfirmation(adapter, payment.txId, minConf, 5, 10_000);
    const updatedState = loadState();
    const updatedPurchase = updatedState.purchases.find((item) => item.id === id);
    if (!updatedPurchase) {
      return NextResponse.json({ error: "Purchase disappeared after payment" }, { status: 500 });
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
    return NextResponse.json({
      ok: true,
      purchase: updatedPurchase,
      confirmationPending: updatedPurchase.status === "pending_confirmation"
    });
  }

  saveState(state);

  const minConf = config.verification?.minConfirmations ?? 1;
  const txInfo = await waitForConfirmation(adapter, payment.txId, minConf, 5, 10_000);
  if (txInfo.status !== "confirmed") {
    const updatedState = loadState();
    const updatedPurchase = updatedState.purchases.find((item) => item.id === id);
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
  const updatedPurchase = updatedState.purchases.find((item) => item.id === id);
  if (!updatedPurchase) {
    return NextResponse.json({ error: "Purchase disappeared after payment" }, { status: 500 });
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
    return NextResponse.json({ ok: true, purchase: updatedPurchase, confirmationPending: true });
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
    return NextResponse.json({ error: "Vendor verification failed" }, { status: 502 });
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

  return NextResponse.json({ ok: true, purchase: updatedPurchase });
}

function acquireApprovalLock(purchaseId: string): { acquired: true; file: string } | { acquired: false; file: string } {
  const dir = path.join(path.dirname(getStatePath()), "locks");
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `approval-${safeLockName(purchaseId)}.lock`);

  try {
    return openApprovalLock(file);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") {
      throw error;
    }
  }

  if (isStaleApprovalLock(file)) {
    fs.rmSync(file, { force: true });
    try {
      return openApprovalLock(file);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") {
        throw error;
      }
    }
  }

  return { acquired: false, file };
}

function openApprovalLock(file: string): { acquired: true; file: string } {
  const fd = fs.openSync(file, "wx");
  fs.writeFileSync(fd, JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }));
  fs.closeSync(fd);
  return { acquired: true, file };
}

function releaseApprovalLock(file: string): void {
  fs.rmSync(file, { force: true });
}

function isStaleApprovalLock(file: string): boolean {
  try {
    const stat = fs.statSync(file);
    return Date.now() - stat.mtimeMs > APPROVAL_LOCK_STALE_MS;
  } catch {
    return false;
  }
}

function safeLockName(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 120) || "unknown";
}

function validateLocalApprovalRequest(request: NextRequest): { ok: true } | { ok: false; error: string } {
  const host = request.headers.get("host") ?? request.nextUrl.host;
  if (!host || !isLocalHost(host)) {
    return { ok: false, error: "Approval requests must target the local AgentZcash dashboard." };
  }

  const origin = request.headers.get("origin");
  if (origin) {
    try {
      const originUrl = new URL(origin);
      if (!isLocalHost(originUrl.host)) {
        return { ok: false, error: "Cross-site approval requests are blocked." };
      }
    } catch {
      return { ok: false, error: "Invalid approval request origin." };
    }
  }

  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite && fetchSite !== "same-origin" && fetchSite !== "none") {
    return { ok: false, error: "Cross-site approval requests are blocked." };
  }

  return { ok: true };
}

function isLocalHost(host: string): boolean {
  const hostname = host.startsWith("[") ? host.slice(1, host.indexOf("]")) : host.split(":")[0];
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
}

function validateApprovalToken(expectedHash: string | undefined, token: string | undefined): boolean {
  if (!expectedHash || !token) return false;

  const actualHash = createHash("sha256").update(token, "utf8").digest("hex");
  const expected = Buffer.from(expectedHash, "hex");
  const actual = Buffer.from(actualHash, "hex");
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
