import { describe, expect, it } from "vitest";
import { evaluateQuotePolicy } from "./policy.js";
import { zecToZats } from "./money.js";
import type { QuoteResponse, ZecGuardConfig, ZecGuardState } from "./types.js";

const config: ZecGuardConfig = {
  agent: { name: "Test", walletMode: "mock", walletAddress: "u1test" },
  spending: { perTransactionZec: "0.05", dailyZec: "0.10", monthlyZec: "1.00" },
  approval: { requireEveryPayment: true, allowOneTimeOverride: true },
  vendors: { allowUnknownVendors: true, trusted: ["http://trusted.test"] },
  privacy: { showPrivacyLabel: true },
  shippingProfiles: []
};

const state: ZecGuardState = {
  wallet: {
    mode: "mock",
    address: "u1test",
    balanceZats: zecToZats("0.25"),
    spentTodayZats: 0,
    spentMonthZats: 0
  },
  purchases: [],
  activity: [],
  vendorOrders: [],
  paymentLedger: []
};

function quote(overrides: Partial<QuoteResponse> = {}): QuoteResponse {
  return {
    quoteId: "q1",
    vendorUrl: "http://trusted.test",
    vendorName: "Trusted",
    itemId: "item",
    itemTitle: "Item",
    amountZec: "0.01",
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    terms: [],
    requiredPii: [],
    fulfillmentType: "digital",
    privacy: { label: "Strong", grade: "strong", leaks: [], summary: "Shielded" },
    memo: "zecguard:q1",
    payTo: "u1vendor000000000000000000000000000000000000000000",
    ...overrides
  };
}

describe("policy", () => {
  it("passes a trusted quote inside limits", () => {
    const result = evaluateQuotePolicy(quote(), config, state);
    expect(result.severity).toBe("pass");
    expect(result.requiresApproval).toBe(true);
  });

  it("blocks over the per-transaction limit", () => {
    const result = evaluateQuotePolicy(quote({ amountZec: "0.06" }), config, state);
    expect(result.severity).toBe("blocked");
  });

  it("warns for unknown vendors when allowed", () => {
    const result = evaluateQuotePolicy(quote({ vendorUrl: "http://new.test" }), config, state);
    expect(result.severity).toBe("warn");
  });
});
