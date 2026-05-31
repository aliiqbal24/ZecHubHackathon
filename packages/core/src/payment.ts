import { randomUUID } from "node:crypto";
import { appendActivity, loadState, recordPayment, saveState } from "./state.js";
import { createWalletAdapter, waitForConfirmation } from "./wallet.js";
import { canApprovePurchase, evaluateGenericPaymentPolicy, evaluateQuotePolicy } from "./policy.js";
import { verifyReceipt } from "./receipt.js";
import { zecToZats, zatsToZec } from "./money.js";
import type { LocalPaymentReceipt, Purchase, ShippingProfile, ZecGuardConfig } from "./types.js";

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

  const adapter = createWalletAdapter(config);
  if (config.agent.walletMode === "external-cli") {
    const liveBalance = await adapter.getBalance();
    if (liveBalance < purchase.amountZats) {
      throw new Error(`Insufficient wallet balance: ${zatsToZec(liveBalance)} ZEC available, ${purchase.amountZec} ZEC needed.`);
    }
  } else if (state.wallet.balanceZats < purchase.amountZats) {
    throw new Error(`Insufficient mock wallet balance: ${zatsToZec(state.wallet.balanceZats)} ZEC available, ${purchase.amountZec} ZEC needed.`);
  }

  const profile =
    config.shippingProfiles.find((item) => item.id === options.profileId) ?? config.shippingProfiles[0];
  const releasedPii = selectReleasedPii(purchase, profile);
  const payment = await adapter.sendPayment(purchase, state, config);
  const now = new Date().toISOString();

  if (config.agent.walletMode === "mock") {
    state.wallet.balanceZats -= payment.amountZats;
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
