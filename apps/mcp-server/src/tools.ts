import { randomUUID } from "node:crypto";
import {
  appendActivity,
  approveAndPayPurchase,
  buildAgentWalletSafetyReport,
  discoverVendor,
  evaluateGenericPaymentPolicy,
  evaluateQuotePolicy,
  loadConfig,
  loadState,
  makeLocalPaymentPurchase,
  reserveVendorOrder,
  requestVendorQuote,
  startWebPurchase,
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
    description: "Read a vendor's ZEC Harness manifest and product list.",
    annotations: { readOnlyHint: true }
  },
  {
    name: "request_quote",
    description: "Request a ZEC-priced quote, reserve an order, and create a user approval request.",
    annotations: { readOnlyHint: false, idempotentHint: false }
  },
  {
    name: "prepare_zec_payment",
    description: "Prepare a generic ZEC payment from a ZIP-321 URI or raw address, amount, and memo.",
    annotations: { readOnlyHint: false, idempotentHint: false }
  },
  {
    name: "start_web_purchase",
    description: "Start a vendor-agnostic web checkout or P2P ZEC purchase session, extract an invoice, and create an approval request without sending funds.",
    annotations: { readOnlyHint: false, idempotentHint: false, openWorldHint: true }
  },
  {
    name: "review_purchase",
    description: "Review exact payment details, policy checks, privacy/PII, expiry, and approval wording.",
    annotations: { readOnlyHint: false }
  },
  {
    name: "approve_and_pay_purchase",
    description: "Destructive, non-idempotent tool that submits an approved ZEC payment.",
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true }
  },
  {
    name: "claim_fulfillment",
    description: "Check a vendor order and store fulfillment/receipt once paid.",
    annotations: { readOnlyHint: false, idempotentHint: true }
  },
  {
    name: "get_zecguard_state",
    description: "Inspect wallet, pending approvals, activity, and receipts.",
    annotations: { readOnlyHint: true }
  },
  {
    name: "get_agent_wallet_status",
    description: "Inspect the dedicated agent spending wallet status, deposit address, and spendable balance.",
    annotations: { readOnlyHint: true }
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
    source: "harness",
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

export async function prepareZecPayment(args: {
  paymentUri?: string;
  address?: string;
  amountZec?: string;
  memo?: string;
  recipientLabel?: string;
  expiresAt?: string;
}) {
  const config = loadConfig();
  const state = loadState();
  const parsed = parsePaymentInput(args);
  const purchase = makeLocalPaymentPurchase({
    amountZec: parsed.amountZec,
    payTo: parsed.address,
    memo: parsed.memo,
    recipientLabel: args.recipientLabel,
    expiresAt: args.expiresAt,
    sourceUri: args.paymentUri,
    config,
    state
  });

  updateState((draft) => {
    upsertPurchase(draft, purchase);
    appendActivity(draft, {
      kind: "quote",
      title: "Agent prepared generic ZEC payment",
      detail: `${purchase.amountZec} ZEC to ${purchase.payTo}.`,
      purchaseId: purchase.id
    });
    appendActivity(draft, {
      kind: "policy",
      title: purchase.policy.severity === "blocked" ? "Policy blocked payment" : "Policy checked payment",
      detail:
        purchase.policy.severity === "blocked"
          ? "Payment cannot proceed without a policy change or override."
          : "Payment is waiting for user approval.",
      purchaseId: purchase.id
    });
  });

  return {
    purchaseId: purchase.id,
    status: purchase.status,
    approvalUrl: `http://localhost:3000/?purchase=${purchase.id}`,
    payment: {
      amountZec: purchase.amountZec,
      payTo: purchase.payTo,
      memo: purchase.memo,
      recipientLabel: purchase.vendorName,
      expiresAt: purchase.expiresAt
    },
    policy: purchase.policy
  };
}

export async function startWebPurchaseTool(args: {
  request: string;
  targetUrl?: string;
  vendorHint?: string;
  productConstraints?: Record<string, unknown>;
  checkoutHtml?: string;
}) {
  return startWebPurchase(args);
}

export async function reviewPurchase(args: { purchaseId: string }) {
  const config = loadConfig();
  let updated: Purchase | undefined;

  updateState((state) => {
    const purchase = state.purchases.find((item) => item.id === args.purchaseId);
    if (!purchase) {
      throw new Error("Purchase not found.");
    }
    purchase.policy =
      purchase.source === "generic"
        ? evaluateGenericPaymentPolicy(
            {
              amountZec: purchase.amountZec,
              payTo: purchase.payTo,
              memo: purchase.memo,
              expiresAt: purchase.expiresAt,
              recipientLabel: purchase.vendorName
            },
            config,
            state
          )
        : evaluateQuotePolicy(purchaseToQuote(purchase), config, state);
    if (!purchase.payment && !["rejected", "expired", "payment_failed", "verification_failed"].includes(purchase.status)) {
      purchase.status = purchase.policy.severity === "blocked" ? "policy_blocked" : "awaiting_approval";
    }
    purchase.updatedAt = new Date().toISOString();
    updated = purchase;
    appendActivity(state, {
      kind: "policy",
      title: "Policy refreshed",
      detail: `Purchase is ${purchase.policy.severity}.`,
      purchaseId: purchase.id
    });
  });

  if (!updated) {
    throw new Error("Purchase not found.");
  }

  return {
    purchaseId: updated.id,
    source: updated.source ?? "harness",
    status: updated.status,
    amountZec: updated.amountZec,
    amountZats: updated.amountZats,
    recipient: {
      name: updated.vendorName,
      payTo: updated.payTo
    },
    memo: updated.memo,
    expiresAt: updated.expiresAt,
    requiredPii: updated.requiredPii,
    privacy: updated.privacy,
    policy: updated.policy,
    approvalWording: `Approve sending ${updated.amountZec} ZEC to ${updated.payTo}? This is a real, non-idempotent payment.`
  };
}

export async function approveAndPayPurchaseTool(args: {
  purchaseId: string;
  overrideReason?: string;
  profileId?: string;
}) {
  const config = loadConfig();
  return approveAndPayPurchase(config, {
    purchaseId: args.purchaseId,
    overrideReason: args.overrideReason,
    profileId: args.profileId,
    approvedBy: "mcp"
  });
}

export async function claimFulfillment(args: { purchaseId: string }) {
  let purchase = loadState().purchases.find((item) => item.id === args.purchaseId);
  if (!purchase) {
    throw new Error("Purchase not found.");
  }
  if (purchase.source === "generic") {
    throw new Error("Generic ZEC payments do not support automatic fulfillment claims.");
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

export async function getAgentWalletStatus() {
  const state = loadState();
  const config = loadConfig();
  const safety = buildAgentWalletSafetyReport(state.agentWallet, config);
  return {
    wallet: state.agentWallet,
    safety,
    setup:
      state.agentWallet.backend === "zingo-cli"
        ? {
            zingoCliRequired: true,
            funding: state.agentWallet.depositAddress
              ? safety.readyForRealFunding
                ? "Dashboard checklist is complete. Keep real funding below the configured safety cap."
                : `Not ready to fund. Complete dashboard safety checks first. Deposit fingerprint: ${safety.depositAddressFingerprint ?? "unavailable"}.`
              : "Create or refresh the wallet from the dashboard to get a deposit address.",
            dashboardOnlyActions: ["backup confirmation", "return address verification", "preflight", "sweep"]
          }
        : {
            zingoCliRequired: false,
            funding: "Mock wallet is funded locally for demos."
          }
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
    case "prepare_zec_payment":
      return prepareZecPayment({
        paymentUri: typeof args.paymentUri === "string" ? args.paymentUri : undefined,
        address: typeof args.address === "string" ? args.address : undefined,
        amountZec: typeof args.amountZec === "string" ? args.amountZec : undefined,
        memo: typeof args.memo === "string" ? args.memo : undefined,
        recipientLabel: typeof args.recipientLabel === "string" ? args.recipientLabel : undefined,
        expiresAt: typeof args.expiresAt === "string" ? args.expiresAt : undefined
      });
    case "start_web_purchase":
      return startWebPurchaseTool({
        request: String(args.request ?? ""),
        targetUrl: typeof args.targetUrl === "string" ? args.targetUrl : undefined,
        vendorHint: typeof args.vendorHint === "string" ? args.vendorHint : undefined,
        productConstraints:
          typeof args.productConstraints === "object" && args.productConstraints !== null
            ? (args.productConstraints as Record<string, unknown>)
            : undefined,
        checkoutHtml: typeof args.checkoutHtml === "string" ? args.checkoutHtml : undefined
      });
    case "prepare_purchase":
    case "review_purchase":
      return reviewPurchase({ purchaseId: String(args.purchaseId ?? "") });
    case "approve_and_pay_purchase":
      return approveAndPayPurchaseTool({
        purchaseId: String(args.purchaseId ?? ""),
        overrideReason: typeof args.overrideReason === "string" ? args.overrideReason : undefined,
        profileId: typeof args.profileId === "string" ? args.profileId : undefined
      });
    case "claim_fulfillment":
      return claimFulfillment({ purchaseId: String(args.purchaseId ?? "") });
    case "get_zecguard_state":
      return getZecGuardState();
    case "get_agent_wallet_status":
      return getAgentWalletStatus();
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

function parsePaymentInput(args: {
  paymentUri?: string;
  address?: string;
  amountZec?: string;
  memo?: string;
}): { address: string; amountZec: string; memo: string } {
  if (args.paymentUri) {
    const match = args.paymentUri.match(/^zcash:([^?]+)(?:\?(.*))?$/i);
    if (!match) {
      throw new Error("paymentUri must be a ZIP-321 zcash: URI.");
    }
    const params = new URLSearchParams(match[2] ?? "");
    const address = decodeURIComponent(match[1] ?? "");
    const amountZec = params.get("amount") ?? args.amountZec;
    const memo = params.get("memo") ?? params.get("message") ?? args.memo ?? "";
    if (!amountZec) {
      throw new Error("Payment amount is required.");
    }
    return { address, amountZec, memo };
  }

  if (!args.address) {
    throw new Error("address is required when paymentUri is not supplied.");
  }
  if (!args.amountZec) {
    throw new Error("amountZec is required when paymentUri is not supplied.");
  }
  return {
    address: args.address,
    amountZec: args.amountZec,
    memo: args.memo ?? ""
  };
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
