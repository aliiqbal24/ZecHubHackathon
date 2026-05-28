import { harnessManifestSchema, orderResponseSchema, quoteResponseSchema } from "./schemas.js";
import type { HarnessManifest, OrderResponse, QuoteRequest, QuoteResponse } from "./types.js";

export async function discoverVendor(vendorUrl: string): Promise<HarnessManifest> {
  const base = vendorUrl.replace(/\/$/, "");
  const response = await fetch(`${base}/.well-known/zec-harness.json`);
  if (!response.ok) {
    throw new Error(`Vendor manifest failed: ${response.status} ${response.statusText}`);
  }
  return harnessManifestSchema.parse(await response.json());
}

export async function requestVendorQuote(vendorUrl: string, request: QuoteRequest): Promise<QuoteResponse> {
  const manifest = await discoverVendor(vendorUrl);
  const response = await fetch(manifest.zecHarness.quoteUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(request)
  });
  if (!response.ok) {
    throw new Error(`Vendor quote failed: ${response.status} ${response.statusText}`);
  }
  return quoteResponseSchema.parse(await response.json());
}

export async function reserveVendorOrder(vendorUrl: string, quoteId: string, releasedPii?: Record<string, unknown>): Promise<OrderResponse> {
  const manifest = await discoverVendor(vendorUrl);
  const response = await fetch(manifest.zecHarness.orderUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ quoteId, releasedPii })
  });
  if (!response.ok) {
    throw new Error(`Vendor order failed: ${response.status} ${response.statusText}`);
  }
  return orderResponseSchema.parse(await response.json());
}
