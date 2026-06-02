import { randomUUID } from "node:crypto";
import { loadConfig } from "./config.js";
import { parseP2PRequest, resolveContact } from "./contacts.js";
import { extractZecInvoices, invoicesAreStable } from "./invoice.js";
import { makeLocalPaymentPurchase } from "./payment.js";
import { getDashboardUrl } from "./setup.js";
import { appendActivity, loadState, upsertPurchase, updateState } from "./state.js";
import type {
  StartWebPurchaseInput,
  StartWebPurchaseResult,
  VendorProfile,
  ZecInvoice
} from "./types.js";

export const vendorProfiles: VendorProfile[] = [
  {
    id: "coinsbee",
    hostPattern: "coinsbee.com",
    displayName: "Coinsbee",
    paymentLabels: ["Zcash", "ZEC", "Cryptocurrency"],
    checkoutUrlPatterns: ["/checkout", "/payment"],
    fulfillmentSelectors: ["order status", "voucher", "gift card"],
    blockedCountries: []
  }
];

export class GenericBrowserCheckoutAdapter {
  async extractInvoice(args: StartWebPurchaseInput): Promise<{
    html: string;
    invoices: ZecInvoice[];
    needsUserInput?: { field: string; reason: string };
    notes: string[];
  }> {
    const notes: string[] = [];
    const html = args.checkoutHtml ?? (args.targetUrl ? await fetchPage(args.targetUrl) : "");

    if (!html) {
      return {
        html,
        invoices: [],
        needsUserInput: {
          field: "targetUrl",
          reason: "No checkout page or target URL was supplied."
        },
        notes
      };
    }

    const invoices = extractZecInvoices(html, args.targetUrl);
    const blocker = detectUserInputBlocker(html);
    if (blocker && invoices.length === 0) {
      notes.push("Checkout paused before invoice extraction.");
      return { html, invoices, needsUserInput: blocker, notes };
    }

    if (invoices.length > 0) {
      notes.push(`Extracted ${invoices.length} ZEC invoice candidate${invoices.length === 1 ? "" : "s"}.`);
    }

    return { html, invoices, notes };
  }
}

export async function startWebPurchase(args: StartWebPurchaseInput): Promise<StartWebPurchaseResult> {
  const sessionId = `wps_${randomUUID()}`;
  const p2p = parseP2PRequest(args.request);
  if (p2p) {
    return startP2PPurchase(sessionId, args, p2p);
  }

  const adapter = new GenericBrowserCheckoutAdapter();
  const profile = matchVendorProfile(args.targetUrl ?? args.vendorHint);
  const extraction = await adapter.extractInvoice(args);
  const notes = [...extraction.notes];

  if (extraction.needsUserInput) {
    return {
      sessionId,
      checkoutStatus: "needs_user_input",
      nextAction: "provide_user_input",
      needsUserInput: extraction.needsUserInput,
      vendorProfile: profile,
      notes
    };
  }

  if (!extraction.invoices.length) {
    return {
      sessionId,
      checkoutStatus: "not_supported",
      nextAction: "no_zec_invoice_found",
      vendorProfile: profile,
      notes: [...notes, "No ZIP-321 URI, Zcash address + amount, or QR payload was found."]
    };
  }

  const stable = invoicesAreStable(extraction.invoices);
  if (!stable) {
    return {
      sessionId,
      checkoutStatus: "invoice_unstable",
      nextAction: "retry_checkout",
      invoice: extraction.invoices[0],
      vendorProfile: profile,
      notes: [...notes, "Multiple conflicting ZEC invoice details were found; review is required before retrying."]
    };
  }

  const invoice = extraction.invoices[0]!;
  const config = loadConfig();
  const state = loadState();
  const vendorName = profile?.displayName ?? args.vendorHint ?? hostLabel(args.targetUrl) ?? "Web checkout";
  const recipientTrusted =
    profile?.trusted === true || (args.targetUrl ? config.vendors.trusted.includes(originOf(args.targetUrl)) : false);
  const purchase = makeLocalPaymentPurchase({
    amountZec: invoice.amountZec,
    payTo: invoice.payTo,
    memo: invoice.memo,
    recipientLabel: vendorName,
    expiresAt: invoice.expiresAt,
    sourceUri: invoice.paymentUri ?? args.targetUrl,
    itemTitle: `Web checkout: ${args.request}`,
    recipientTrusted,
    fulfillmentKnown: Boolean(invoice.statusUrl || invoice.orderUrl || profile?.fulfillmentSelectors?.length),
    invoiceStable: true,
    config,
    state
  });

  updateState((draft) => {
    upsertPurchase(draft, purchase);
    appendActivity(draft, {
      kind: "quote",
      title: "Agent extracted web checkout invoice",
      detail: `${purchase.amountZec} ZEC invoice from ${purchase.vendorName}.`,
      purchaseId: purchase.id
    });
    appendActivity(draft, {
      kind: "policy",
      title: purchase.policy.severity === "blocked" ? "Policy blocked web purchase" : "Policy checked web purchase",
      detail:
        purchase.policy.severity === "blocked"
          ? "Web checkout payment cannot proceed without review or policy change."
          : "Web checkout payment is waiting for approval.",
      purchaseId: purchase.id
    });
  });

  return {
    sessionId,
    checkoutStatus: "invoice_found",
    nextAction: "review_purchase",
    purchaseId: purchase.id,
    approvalUrl: `${getDashboardUrl()}/?purchase=${purchase.id}`,
    invoice,
    policy: purchase.policy,
    vendorProfile: profile,
    notes
  };
}

function startP2PPurchase(
  sessionId: string,
  args: StartWebPurchaseInput,
  p2p: { contactName: string; amountZec: string; memo: string }
): StartWebPurchaseResult {
  const matches = resolveContact(p2p.contactName);
  if (matches.length !== 1) {
    return {
      sessionId,
      checkoutStatus: "needs_user_input",
      nextAction: "provide_user_input",
      needsUserInput: {
        field: "contactName",
        reason: matches.length === 0 ? `No contact named "${p2p.contactName}" was found.` : `"${p2p.contactName}" matched multiple contacts.`
      },
      notes: ["P2P request detected from natural language."]
    };
  }

  const contact = matches[0]!;
  const config = loadConfig();
  const state = loadState();
  const purchase = makeLocalPaymentPurchase({
    amountZec: p2p.amountZec,
    payTo: contact.address,
    memo: p2p.memo,
    recipientLabel: contact.name,
    itemTitle: `P2P payment to ${contact.name}`,
    recipientTrusted: contact.trusted,
    fulfillmentKnown: true,
    invoiceStable: true,
    config,
    state
  });

  updateState((draft) => {
    upsertPurchase(draft, purchase);
    appendActivity(draft, {
      kind: "quote",
      title: "Agent prepared P2P ZEC payment",
      detail: `${purchase.amountZec} ZEC to ${contact.name}.`,
      purchaseId: purchase.id
    });
    appendActivity(draft, {
      kind: "policy",
      title: purchase.policy.severity === "blocked" ? "Policy blocked P2P payment" : "Policy checked P2P payment",
      detail:
        purchase.policy.severity === "blocked"
          ? "P2P payment cannot proceed without review or policy change."
          : "P2P payment is waiting for approval.",
      purchaseId: purchase.id
    });
  });

  return {
    sessionId,
    checkoutStatus: "invoice_found",
    nextAction: "review_purchase",
    purchaseId: purchase.id,
    approvalUrl: `${getDashboardUrl()}/?purchase=${purchase.id}`,
    invoice: {
      payTo: contact.address,
      amountZec: p2p.amountZec,
      memo: p2p.memo,
      source: "visible-text"
    },
    policy: purchase.policy,
    notes: [`Resolved ${args.request} to local contact ${contact.name}.`]
  };
}

export function matchVendorProfile(value: string | undefined): VendorProfile | undefined {
  if (!value) return undefined;
  return vendorProfiles.find((profile) => value.toLowerCase().includes(profile.hostPattern.toLowerCase()));
}

function detectUserInputBlocker(html: string): { field: string; reason: string } | undefined {
  const text = html.toLowerCase();
  if (/\bcaptcha\b|g-recaptcha|hcaptcha/.test(text)) {
    return { field: "captcha", reason: "Checkout requires captcha completion." };
  }
  if (/\blog in\b|\bsign in\b|password/.test(text)) {
    return { field: "login", reason: "Checkout requires a logged-in account." };
  }
  if (/\bemail\b/.test(text) && /<input[^>]+(?:name|type)=["']?email/i.test(html)) {
    return { field: "email", reason: "Checkout requires an email address before exposing a ZEC invoice." };
  }
  if (/\bcountry\b/.test(text) && /<select[^>]+name=["']?country/i.test(html)) {
    return { field: "country", reason: "Checkout requires a country selection before exposing a ZEC invoice." };
  }
  return undefined;
}

async function fetchPage(url: string): Promise<string> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Checkout page fetch failed: ${response.status}`);
  }
  return response.text();
}

function hostLabel(url: string | undefined): string | undefined {
  if (!url) return undefined;
  try {
    return new URL(url).hostname;
  } catch {
    return undefined;
  }
}

function originOf(url: string): string {
  try {
    return new URL(url).origin;
  } catch {
    return url;
  }
}
