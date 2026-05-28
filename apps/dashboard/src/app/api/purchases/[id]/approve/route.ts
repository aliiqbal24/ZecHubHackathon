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
  waitForConfirmation,
  zatsToZec,
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

  const adapter = createWalletAdapter(config);

  if (config.agent.walletMode === "external-cli") {
    try {
      const liveBalance = await adapter.getBalance();
      if (liveBalance < purchase.amountZats) {
        return NextResponse.json(
          { error: `Insufficient wallet balance: ${zatsToZec(liveBalance)} ZEC available, ${purchase.amountZec} ZEC needed.` },
          { status: 402 }
        );
      }
    } catch (err) {
      return NextResponse.json(
        { error: `Could not check wallet balance: ${err instanceof Error ? err.message : String(err)}` },
        { status: 502 }
      );
    }
  }

  const profile =
    config.shippingProfiles.find((item) => item.id === body.profileId) ?? config.shippingProfiles[0];
  const releasedPii = selectReleasedPii(purchase, profile);
  const payment = await adapter.sendPayment(purchase, state, config);
  const now = new Date().toISOString();

  if (config.agent.walletMode === "mock") {
    state.wallet.balanceZats -= payment.amountZats;
  }
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

  if (config.agent.walletMode === "external-cli") {
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
