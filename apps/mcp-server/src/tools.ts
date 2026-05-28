import { randomUUID } from "node:crypto";
import {
  appendActivity,
  discoverVendor,
  evaluateQuotePolicy,
  loadConfig,
  loadState,
  reserveVendorOrder,
  requestVendorQuote,
  upsertPurchase,
  updateState,
  verifyReceipt,
  zecToZats,
  type Purchase,
  type QuoteResponse
} from "@zecguard/core";

export const toolDefinitions = [
  {
    name: "discover_zec_vendor",
    description: "Read a vendor's ZEC Harness manifest and product list."
  },
  {
    name: "request_quote",
    description: "Request a ZEC-priced quote, reserve an order, and create a user approval request."
  },
  {
    name: "prepare_purchase",
    description: "Re-run policy checks for a pending purchase."
  },
  {
    name: "claim_fulfillment",
    description: "Check a vendor order and store fulfillment/receipt once paid."
  },
  {
    name: "get_zecguard_state",
    description: "Inspect wallet, pending approvals, activity, and receipts."
  }
];

export async function discoverZecVendor(args: { url: string }) {
  return discoverVendor(args.url);
}

export async function requestQuote(args: {
  vendorUrl: string;
  itemId: string;
  options?: Record<string, unknown>;
}) {
  const config = loadConfig();
  const quote = await requestVendorQuote(args.vendorUrl, {
    itemId: args.itemId,
    options: args.options
  });
  const order = await reserveVendorOrder(args.vendorUrl, quote.quoteId);
  const state = loadState();
  const policy = evaluateQuotePolicy(quote, config, state);
  const now = new Date().toISOString();

  const purchase: Purchase = {
    id: `p_${randomUUID()}`,
    status: policy.severity === "blocked" ? "policy_blocked" : "awaiting_approval",
    createdAt: now,
    updatedAt: now,
    vendorUrl: quote.vendorUrl,
    vendorName: quote.vendorName,
    itemId: quote.itemId,
    itemTitle: quote.itemTitle,
    amountZec: quote.amountZec,
    amountZats: zecToZats(quote.amountZec),
    fulfillmentType: quote.fulfillmentType,
    terms: quote.terms,
    requiredPii: quote.requiredPii,
    privacy: quote.privacy,
    policy,
    quoteId: quote.quoteId,
    orderId: order.orderId,
    payTo: order.payTo,
    memo: order.memo,
    expiresAt: order.expiresAt
  };

  updateState((draft) => {
    upsertPurchase(draft, purchase);
    appendActivity(draft, {
      kind: "quote",
      title: "Agent requested purchase",
      detail: `${quote.itemTitle} from ${quote.vendorName} for ${quote.amountZec} ZEC.`,
      purchaseId: purchase.id
    });
    appendActivity(draft, {
      kind: "policy",
      title: policy.severity === "blocked" ? "Policy blocked purchase" : "Policy checked purchase",
      detail:
        policy.severity === "blocked"
          ? "Purchase cannot proceed without a policy change or override."
          : "Purchase is waiting for user approval.",
      purchaseId: purchase.id
    });
  });

  return {
    purchaseId: purchase.id,
    status: purchase.status,
    approvalUrl: `http://localhost:3000/?purchase=${purchase.id}`,
    quote,
    order,
    policy
  };
}

export async function preparePurchase(args: { purchaseId: string }) {
  const config = loadConfig();
  let updated: Purchase | undefined;

  updateState((state) => {
    const purchase = state.purchases.find((item) => item.id === args.purchaseId);
    if (!purchase) {
      throw new Error("Purchase not found.");
    }
    const quote = purchaseToQuote(purchase);
    purchase.policy = evaluateQuotePolicy(quote, config, state);
    purchase.status = purchase.policy.severity === "blocked" ? "policy_blocked" : "awaiting_approval";
    purchase.updatedAt = new Date().toISOString();
    updated = purchase;
    appendActivity(state, {
      kind: "policy",
      title: "Policy refreshed",
      detail: `Purchase is ${purchase.policy.severity}.`,
      purchaseId: purchase.id
    });
  });

  return updated;
}

export async function claimFulfillment(args: { purchaseId: string }) {
  let purchase = loadState().purchases.find((item) => item.id === args.purchaseId);
  if (!purchase) {
    throw new Error("Purchase not found.");
  }

  const response = await fetch(`${purchase.vendorUrl.replace(/\/$/, "")}/orders/${purchase.orderId}`);
  if (!response.ok) {
    throw new Error(`Vendor order lookup failed: ${response.status}`);
  }
  const order = (await response.json()) as {
    status?: string;
    fulfillment?: Purchase["fulfillment"];
    receipt?: Purchase["receipt"];
  };

  updateState((state) => {
    const existing = state.purchases.find((item) => item.id === args.purchaseId);
    if (!existing) return;
    if (order.status === "fulfilled" && order.fulfillment && order.receipt) {
      existing.status = "receipted";
      existing.fulfillment = order.fulfillment;
      existing.receipt = order.receipt;
      existing.updatedAt = new Date().toISOString();
      appendActivity(state, {
        kind: "receipt",
        title: verifyReceipt(order.receipt) ? "Private receipt verified" : "Receipt signature failed",
        detail: order.receipt.summary,
        purchaseId: existing.id
      });
    }
    purchase = existing;
  });

  return purchase;
}

export async function getZecGuardState() {
  return {
    config: loadConfig(),
    state: loadState()
  };
}

export async function callTool(name: string, args: Record<string, unknown>) {
  switch (name) {
    case "discover_zec_vendor":
      return discoverZecVendor({ url: String(args.url ?? "") });
    case "request_quote":
      return requestQuote({
        vendorUrl: String(args.vendorUrl ?? ""),
        itemId: String(args.itemId ?? ""),
        options: typeof args.options === "object" && args.options !== null ? (args.options as Record<string, unknown>) : undefined
      });
    case "prepare_purchase":
      return preparePurchase({ purchaseId: String(args.purchaseId ?? "") });
    case "claim_fulfillment":
      return claimFulfillment({ purchaseId: String(args.purchaseId ?? "") });
    case "get_zecguard_state":
      return getZecGuardState();
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

function purchaseToQuote(purchase: Purchase): QuoteResponse {
  return {
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
  };
}
