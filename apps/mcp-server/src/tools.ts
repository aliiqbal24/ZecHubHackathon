import { createHash, randomBytes, randomUUID } from "node:crypto";
import {
  appendActivity,
  directTransferRequestSchema,
  discoverVendor,
  evaluateDirectTransferPolicy,
  evaluateQuotePolicy,
  executePaymentWithLock,
  loadConfig,
  loadState,
  refreshPendingDirectTransferConfirmations,
  reserveVendorOrder,
  requestVendorQuote,
  saveState,
  upsertPurchase,
  upsertVendorOrder,
  updateState,
  verifyReceipt,
  zecToZats,
  type Purchase,
  type QuoteResponse
} from "@agentzcash/core";

export const toolDefinitions = [
  {
    name: "discover_zec_vendor",
    description: "Read a vendor's ZEC Harness manifest and product list."
  },
  {
    name: "request_quote",
    description: "Request a ZEC-priced quote, reserve an order, and submit payment when policy allows or create a user approval request."
  },
  {
    name: "prepare_purchase",
    description: "Re-run policy checks for a pending purchase."
  },
  {
    name: "prepare_direct_transfer",
    description: "Prepare a direct ZEC transfer and submit payment when policy allows or create a user approval request."
  },
  {
    name: "claim_fulfillment",
    description: "Check a vendor order and store fulfillment/receipt once paid."
  },
  {
    name: "get_agentzcash_state",
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
  const needsDashboardApproval = policy.severity !== "blocked" && policy.requiresApproval;
  const approvalToken = needsDashboardApproval ? createApprovalToken() : undefined;

  const purchase: Purchase = {
    id: `p_${randomUUID()}`,
    kind: "vendor_purchase",
    status: policy.severity === "blocked" ? "policy_blocked" : needsDashboardApproval ? "awaiting_approval" : "policy_checked",
    createdAt: now,
    updatedAt: now,
    vendorUrl: quote.vendorUrl,
    vendorName: quote.vendorName,
    itemId: quote.itemId,
    itemTitle: quote.itemTitle,
    amountZec: quote.amountZec,
    amountZats: safeZecToZats(quote.amountZec),
    fulfillmentType: quote.fulfillmentType,
    terms: quote.terms,
    requiredPii: quote.requiredPii,
    privacy: quote.privacy,
    policy,
    quoteId: quote.quoteId,
    orderId: order.orderId,
    payTo: order.payTo,
    memo: order.memo,
    expiresAt: order.expiresAt,
    approvalTokenHash: approvalToken ? hashApprovalToken(approvalToken) : undefined
  };

  updateState((draft) => {
    upsertPurchase(draft, purchase);
    upsertVendorOrder(draft, {
      orderId: order.orderId,
      quote,
      status: order.status,
      createdAt: now
    });
    appendActivity(draft, {
      kind: "quote",
      title: "Purchase requested by agent",
      detail: `${quote.itemTitle} from ${quote.vendorName} for ${quote.amountZec} ZEC.`,
      purchaseId: purchase.id
    });
    appendActivity(draft, {
      kind: "policy",
      title: policy.severity === "blocked" ? "Policy blocked purchase" : "Policy checked purchase",
      detail:
        policy.severity === "blocked"
          ? "Purchase cannot proceed without a policy change or override."
          : needsDashboardApproval
            ? "Purchase is waiting for user approval."
            : "Purchase is eligible for autonomous payment.",
      purchaseId: purchase.id
    });
  });

  if (purchase.status === "policy_checked") {
    const result = await executePaymentWithLock(purchase.id, { actor: "policy" });
    return {
      purchaseId: purchase.id,
      status: result.ok ? result.purchase.status : result.purchase?.status ?? "payment_failed",
      approvalUrl: undefined,
      paymentResult: result,
      quote,
      order,
      policy
    };
  }

  return {
    purchaseId: purchase.id,
    status: purchase.status,
    approvalUrl: approvalToken ? buildApprovalUrl(purchase.id, approvalToken) : undefined,
    quote,
    order,
    policy
  };
}

export async function prepareDirectTransfer(args: Record<string, unknown>) {
  const request = directTransferRequestSchema.parse(args);
  const config = loadConfig();
  const state = loadState();
  const policy = evaluateDirectTransferPolicy(request, config, state);
  const now = new Date().toISOString();
  const needsDashboardApproval = policy.severity !== "blocked" && policy.requiresApproval;
  const approvalToken = needsDashboardApproval ? createApprovalToken() : undefined;
  const evidenceSummary = request.evidenceUrls.length
    ? request.evidenceUrls.join(", ")
    : request.agentVerificationNotes || "No external evidence supplied.";

  const purchase: Purchase = {
    id: `p_${randomUUID()}`,
    kind: "direct_transfer",
    status: policy.severity === "blocked" ? "policy_blocked" : needsDashboardApproval ? "awaiting_approval" : "policy_checked",
    createdAt: now,
    updatedAt: now,
    vendorUrl: "direct:zec",
    vendorName: request.recipientName,
    itemId: "direct-transfer",
    itemTitle: `Direct transfer to ${request.recipientName}`,
    amountZec: request.amountZec,
    amountZats: safeZecToZats(request.amountZec),
    fulfillmentType: "service",
    terms: [
      request.purpose || "Direct ZEC transfer requested by agent.",
      `Evidence: ${evidenceSummary}`
    ],
    requiredPii: [],
    privacy: {
      label: "Shielded ZEC",
      grade: "strong",
      leaks: ["Recipient address and amount are shown for approval."],
      summary: "AgentZcash queues the transfer locally and may submit it only when policy allows."
    },
    policy,
    quoteId: `direct_${randomUUID()}`,
    orderId: `direct_${randomUUID()}`,
    payTo: request.address,
    memo: request.memo,
    expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    approvalTokenHash: approvalToken ? hashApprovalToken(approvalToken) : undefined,
    directTransfer: request
  };

  updateState((draft) => {
    upsertPurchase(draft, purchase);
    appendActivity(draft, {
      kind: "transfer",
      title: "Direct transfer requested by agent",
      detail: needsDashboardApproval
        ? `${request.amountZec} ZEC to ${request.recipientName} is waiting for user approval.`
        : `${request.amountZec} ZEC to ${request.recipientName} is eligible for autonomous payment.`,
      purchaseId: purchase.id
    });
    appendActivity(draft, {
      kind: "policy",
      title: policy.severity === "blocked" ? "Policy blocked direct transfer" : "Policy checked direct transfer",
      detail:
        policy.severity === "blocked"
          ? "Transfer cannot proceed without a policy change or override."
          : needsDashboardApproval
            ? "Transfer is waiting for user approval."
            : "Transfer is eligible for autonomous payment.",
      purchaseId: purchase.id
    });
  });

  if (purchase.status === "policy_checked") {
    const result = await executePaymentWithLock(purchase.id, { actor: "policy" });
    return {
      purchaseId: purchase.id,
      status: result.ok ? result.purchase.status : result.purchase?.status ?? "payment_failed",
      approvalUrl: undefined,
      paymentResult: result,
      policy,
      transfer: {
        recipientName: request.recipientName,
        address: request.address,
        amountZec: request.amountZec,
        memo: request.memo,
        purpose: request.purpose,
        evidenceSummary
      }
    };
  }

  return {
    purchaseId: purchase.id,
    status: purchase.status,
    approvalUrl: approvalToken ? buildApprovalUrl(purchase.id, approvalToken) : undefined,
    policy,
    transfer: {
      recipientName: request.recipientName,
      address: request.address,
      amountZec: request.amountZec,
      memo: request.memo,
      purpose: request.purpose,
      evidenceSummary
    }
  };
}

function createApprovalToken(): string {
  return randomBytes(32).toString("base64url");
}

function hashApprovalToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

function buildApprovalUrl(purchaseId: string, approvalToken?: string): string {
  const url = new URL("http://localhost:3000/");
  url.searchParams.set("purchase", purchaseId);
  if (approvalToken) {
    url.searchParams.set("approvalToken", approvalToken);
  }
  return url.toString();
}

export async function preparePurchase(args: { purchaseId: string }) {
  const config = loadConfig();
  let updated: Purchase | undefined;

  updateState((state) => {
    const purchase = state.purchases.find((item) => item.id === args.purchaseId);
    if (!purchase) {
      throw new Error("Purchase not found.");
    }
    purchase.policy =
      purchase.kind === "direct_transfer" && purchase.directTransfer
        ? evaluateDirectTransferPolicy(purchase.directTransfer, config, state)
        : evaluateQuotePolicy(purchaseToQuote(purchase), config, state);
    purchase.status =
      purchase.policy.severity === "blocked"
        ? "policy_blocked"
        : purchase.policy.requiresApproval
          ? "awaiting_approval"
          : "policy_checked";
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

function safeZecToZats(value: string): number {
  try {
    return zecToZats(value);
  } catch {
    return 0;
  }
}

export async function claimFulfillment(args: { purchaseId: string }) {
  let purchase = loadState().purchases.find((item) => item.id === args.purchaseId);
  if (!purchase) {
    throw new Error("Purchase not found.");
  }
  if (purchase.kind === "direct_transfer") {
    throw new Error("Direct transfers do not use vendor fulfillment.");
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

export async function getAgentZcashState() {
  const config = loadConfig();
  const state = loadState();
  if (await refreshPendingDirectTransferConfirmations(state, config)) {
    saveState(state);
  }

  return {
    config,
    state
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
    case "prepare_direct_transfer":
      return prepareDirectTransfer(args);
    case "claim_fulfillment":
      return claimFulfillment({ purchaseId: String(args.purchaseId ?? "") });
    case "get_agentzcash_state":
      return getAgentZcashState();
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
