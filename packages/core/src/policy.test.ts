import { describe, expect, it } from "vitest";
import { canAutopayByPolicy, evaluateGenericPaymentPolicy, evaluateQuotePolicy } from "./policy.js";
import { zecToZats } from "./money.js";
import { createDefaultAgentWalletSafety } from "./safety.js";
import type { QuoteResponse, ZecGuardConfig, ZecGuardState } from "./types.js";

const config: ZecGuardConfig = {
  agent: { name: "Test", walletMode: "mock", walletAddress: "u1test" },
  agentWallet: {
    backend: "mock",
    label: "Test Wallet",
    walletId: "agent-default",
    zingoCliPath: "zingo-cli",
    maxRealWalletBalanceZec: "0.05"
  },
  spending: { perTransactionZec: "0.05", dailyZec: "0.10", monthlyZec: "1.00" },
  approval: { requireEveryPayment: true, allowOneTimeOverride: true },
  vendors: { allowUnknownVendors: true, trusted: ["http://trusted.test"] },
  privacy: { showPrivacyLabel: true },
  shippingProfiles: []
};

const state: ZecGuardState = {
  agentWallet: {
    id: "agent-default",
    label: "Test Wallet",
    backend: "mock",
    status: "ready",
    dataDir: ".zecguard/wallets/agent-default",
    depositAddress: "u1test",
    balanceZats: zecToZats("0.25"),
    spendableZats: zecToZats("0.25"),
    createdAt: new Date().toISOString(),
    safety: createDefaultAgentWalletSafety()
  },
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

  it("allows autopay eligibility only for clean trusted generic payments when approval is not required", () => {
    const result = evaluateGenericPaymentPolicy(
      {
        amountZec: "0.003",
        payTo: "u1contact00000000000000000000000000000000000000000",
        memo: "send Ali 0.003 ZEC",
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
        recipientLabel: "Ali",
        recipientTrusted: true,
        fulfillmentKnown: true,
        invoiceStable: true
      },
      { ...config, approval: { ...config.approval, requireEveryPayment: false } },
      state
    );

    expect(result.severity).toBe("pass");
    expect(canAutopayByPolicy(result, { ...config, approval: { ...config.approval, requireEveryPayment: false } })).toBe(true);
  });

  it("blocks generic payments when an extracted invoice is unstable", () => {
    const result = evaluateGenericPaymentPolicy(
      {
        amountZec: "0.003",
        payTo: "u1contact00000000000000000000000000000000000000000",
        memo: "checkout",
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
        recipientTrusted: true,
        fulfillmentKnown: true,
        invoiceStable: false
      },
      config,
      state
    );

    expect(result.severity).toBe("blocked");
  });
});
