import { describe, expect, it } from "vitest";
import { evaluateDirectTransferPolicy, evaluateQuotePolicy } from "./policy.js";
import { zecToZats } from "./money.js";
import type { QuoteResponse, AgentZcashConfig, AgentZcashState } from "./types.js";

const config: AgentZcashConfig = {
  agent: { name: "Test", walletMode: "external-cli", walletAddress: "u1test" },
  spending: { perTransactionZec: "0.05", dailyZec: "0.10", monthlyZec: "1.00" },
  approval: { requireEveryPayment: true, allowOneTimeOverride: true },
  vendors: { allowUnknownVendors: true, trusted: ["http://trusted.test"] },
  privacy: { showPrivacyLabel: true },
  shippingProfiles: []
};

const state: AgentZcashState = {
  wallet: {
    mode: "external-cli",
    address: "u1test",
    balanceZats: zecToZats("0.25"),
    spentTodayZats: 0,
    spentMonthZats: 0
  },
  purchases: [],
  activity: [],
  vendorOrders: []
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
    memo: "agentzcash:q1",
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

  it("passes a direct transfer inside limits without vendor checks", () => {
    const result = evaluateDirectTransferPolicy(
      {
        recipientName: "Alice",
        amountZec: "0.01",
        address: "u1recipient0000000000000000000000000000000000000000",
        memo: "thanks",
        purpose: "Test payment",
        evidenceUrls: ["https://example.com/invoice"],
        agentVerificationNotes: ""
      },
      config,
      state
    );

    expect(result.severity).toBe("pass");
    expect(result.requiresApproval).toBe(true);
    expect(result.checks.some((check) => check.id === "vendor")).toBe(false);
  });

  it("blocks a direct transfer with malformed address", () => {
    const result = evaluateDirectTransferPolicy(
      {
        recipientName: "Alice",
        amountZec: "0.01",
        address: "not-zcash",
        memo: "",
        purpose: "Test payment",
        evidenceUrls: [],
        agentVerificationNotes: "verified manually"
      },
      config,
      state
    );

    expect(result.severity).toBe("blocked");
  });

  it("blocks a direct transfer to a transparent-only address", () => {
    const result = evaluateDirectTransferPolicy(
      {
        recipientName: "Alice",
        amountZec: "0.01",
        address: "t1TransparentRecipient0000000000000000000000000",
        memo: "",
        purpose: "Test payment",
        evidenceUrls: [],
        agentVerificationNotes: "verified manually"
      },
      config,
      state
    );

    expect(result.severity).toBe("blocked");
    expect(result.checks.find((check) => check.id === "address")?.detail).toContain("shielded-capable");
  });
});
