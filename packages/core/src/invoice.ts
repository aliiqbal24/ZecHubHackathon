import { isLikelyZcashAddress } from "./address.js";
import { zecToZats } from "./money.js";
import type { ZecInvoice } from "./types.js";

const ZCASH_URI_RE = /zcash:([^\s"'<>]+)(?:\?([^\s"'<>]+))?/gi;
const ZCASH_ADDRESS_RE = /\b(?:u1|utest|zs|ztestsapling|t1|t3|tm|tex)[a-zA-Z0-9]{20,}\b/g;
const ZEC_AMOUNT_RE = /\b(?:amount|total|pay|send|price)?\s*[:=]?\s*([0-9]+(?:\.[0-9]{1,8})?)\s*ZEC\b/gi;
const DATA_QR_RE = /data-(?:qr|qr-payload|payload)=["']([^"']+)["']/gi;

export function parseZcashPaymentUri(paymentUri: string): ZecInvoice {
  const match = paymentUri.trim().match(/^zcash:([^?]+)(?:\?(.*))?$/i);
  if (!match) {
    throw new Error("Payment URI must be a ZIP-321 zcash: URI.");
  }

  const params = new URLSearchParams(match[2] ?? "");
  const payTo = decodeURIComponent(match[1] ?? "").trim();
  const amountZec = params.get("amount")?.trim();
  if (!isLikelyZcashAddress(payTo)) {
    throw new Error("Payment URI does not contain a supported Zcash address.");
  }
  if (!amountZec) {
    throw new Error("Payment URI does not contain an amount.");
  }
  zecToZats(amountZec);

  return {
    payTo,
    amountZec,
    memo: params.get("memo") ?? params.get("message") ?? "",
    expiresAt: normalizeExpiry(params.get("expires") ?? params.get("expiry") ?? undefined),
    paymentUri,
    source: "zip321"
  };
}

export function extractZecInvoices(input: string, baseUrl?: string): ZecInvoice[] {
  const text = htmlToSearchableText(input);
  const invoices = new Map<string, ZecInvoice>();

  for (const payload of extractQrPayloads(input)) {
    if (/^zcash:/i.test(payload)) {
      addInvoice(invoices, { ...parseZcashPaymentUri(payload), source: "qr-payload" });
    }
  }

  for (const match of text.matchAll(ZCASH_URI_RE)) {
    const uri = `zcash:${match[1]}${match[2] ? `?${match[2]}` : ""}`;
    try {
      addInvoice(invoices, parseZcashPaymentUri(uri));
    } catch {
      // Ignore partial URI-like text and keep scanning for address + amount pairs.
    }
  }

  const addresses = [...text.matchAll(ZCASH_ADDRESS_RE)].map((match) => match[0]).filter(isLikelyZcashAddress);
  const amounts = extractAmounts(text);
  if (addresses.length && amounts.length) {
    const firstAddress = addresses[0]!;
    const firstAmount = amounts[0]!;
    addInvoice(invoices, {
      payTo: firstAddress,
      amountZec: firstAmount,
      memo: extractMemo(text),
      expiresAt: extractExpiry(text),
      orderUrl: extractUrl(text, /order(?:\s+status)?\s*[:=]\s*(https?:\/\/\S+)/i, baseUrl),
      statusUrl: extractUrl(text, /status\s*[:=]\s*(https?:\/\/\S+)/i, baseUrl),
      source: "visible-text"
    });
  }

  return [...invoices.values()];
}

export function invoiceFingerprint(invoice: ZecInvoice): string {
  return [invoice.payTo, invoice.amountZec, invoice.memo, invoice.expiresAt ?? ""].join("|");
}

export function invoicesAreStable(invoices: ZecInvoice[]): boolean {
  if (invoices.length <= 1) return true;
  const fingerprints = new Set(invoices.map(invoiceFingerprint));
  return fingerprints.size === 1;
}

function addInvoice(invoices: Map<string, ZecInvoice>, invoice: ZecInvoice): void {
  zecToZats(invoice.amountZec);
  invoices.set(invoiceFingerprint(invoice), invoice);
}

function extractAmounts(text: string): string[] {
  const amounts: string[] = [];
  for (const match of text.matchAll(ZEC_AMOUNT_RE)) {
    const amount = match[1];
    if (!amount) continue;
    try {
      zecToZats(amount);
      amounts.push(amount);
    } catch {
      // Ignore invalid-looking amounts.
    }
  }
  return amounts;
}

function extractQrPayloads(input: string): string[] {
  return [...input.matchAll(DATA_QR_RE)].map((match) => decodeHtml(match[1] ?? "").trim()).filter(Boolean);
}

function htmlToSearchableText(input: string): string {
  return decodeHtml(
    input
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
  );
}

function decodeHtml(input: string): string {
  return input
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function extractMemo(text: string): string {
  const match = text.match(/\b(?:memo|message|reference)\s*[:=]\s*([^\n\r.]{1,160})/i);
  return match?.[1]?.trim() ?? "";
}

function extractExpiry(text: string): string | undefined {
  const match = text.match(/\bexpires(?:\s+at)?\s*[:=]\s*([0-9T:.\-+Z]{10,40})/i);
  return normalizeExpiry(match?.[1]);
}

function normalizeExpiry(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : undefined;
}

function extractUrl(text: string, pattern: RegExp, _baseUrl?: string): string | undefined {
  const match = text.match(pattern);
  return match?.[1]?.replace(/[),.;]+$/, "");
}
