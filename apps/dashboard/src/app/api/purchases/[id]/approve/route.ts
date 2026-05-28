import { NextRequest, NextResponse } from "next/server";
import {
  appendActivity,
  canApprovePurchase,
  createWalletAdapter,
  loadConfig,
  loadState,
  recordPayment,
  saveState,
  verifyReceipt,
  type Purchase,
  type ShippingProfile
} from "@zecguard/core";

export const dynamic = "force-dynamic";

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
  const body = (await request.json().catch(() => ({}))) as {
    profileId?: string;
    overrideReason?: string;
  };
  const config = loadConfig();
  const state = loadState();
  const purchase = state.purchases.find((item) => item.id === id);

  if (!purchase) {
    return NextResponse.json({ error: "Purchase not found" }, { status: 404 });
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

  const profile =
    config.shippingProfiles.find((item) => item.id === body.profileId) ?? config.shippingProfiles[0];
  const releasedPii = selectReleasedPii(purchase, profile);
  const adapter = createWalletAdapter(config);
  const payment = await adapter.sendPayment(purchase, state, config);
  const now = new Date().toISOString();

  state.wallet.balanceZats -= payment.amountZats;
  purchase.status = "payment_submitted";
  purchase.approvedAt = now;
  purchase.updatedAt = now;
  purchase.approvalReason = body.overrideReason;
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
    title: "User approved payment",
    detail: `${purchase.amountZec} ZEC approved for ${purchase.vendorName}.`,
    purchaseId: purchase.id
  });
  appendActivity(state, {
    kind: "payment",
    title: "Payment submitted",
    detail: `${payment.txId} sent to vendor harness.`,
    purchaseId: purchase.id
  });
  saveState(state);

  const vendorResponse = await fetch(`${purchase.vendorUrl.replace(/\/$/, "")}/orders/${purchase.orderId}/verify`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ releasedPii })
  });

  const updatedState = loadState();
  const updatedPurchase = updatedState.purchases.find((item) => item.id === id);
  if (!updatedPurchase) {
    return NextResponse.json({ error: "Purchase disappeared after payment" }, { status: 500 });
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
