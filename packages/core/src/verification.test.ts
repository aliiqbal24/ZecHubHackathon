import { describe, expect, it } from "vitest";
import { MockPaymentVerifier, createPaymentVerifier } from "./verification.js";
import type { ZecGuardConfig } from "./types.js";

function makeConfig(verification: Partial<ZecGuardConfig["verification"]> = {}): ZecGuardConfig {
  return {
    agent: { name: "Test", walletMode: "mock", walletAddress: "u1test" },
    agentWallet: {
      backend: "mock",
      label: "Test Wallet",
      walletId: "agent-default",
      zingoCliPath: "zingo-cli",
      maxRealWalletBalanceZec: "0.05"
    },
    spending: { perTransactionZec: "0.05", dailyZec: "0.15", monthlyZec: "1.00" },
    approval: { requireEveryPayment: true, allowOneTimeOverride: true },
    vendors: { allowUnknownVendors: true, trusted: [] },
    privacy: { showPrivacyLabel: true },
    shippingProfiles: [],
    verification: { mode: "mock", minConfirmations: 1, ...verification }
  };
}

describe("createPaymentVerifier", () => {
  it("creates a verifier for each valid mode", () => {
    expect(createPaymentVerifier(makeConfig({ mode: "mock" }))).toBeInstanceOf(MockPaymentVerifier);
    expect(
      createPaymentVerifier(makeConfig({ mode: "external-cli", externalCliCommand: "zingo-cli notes" }))
    ).toBeDefined();
    expect(
      createPaymentVerifier(makeConfig({ mode: "lightwalletd", lightwalletdUrl: "https://mainnet.lightwalletd.com" }))
    ).toBeDefined();

    const config = makeConfig();
    delete config.verification;
    expect(createPaymentVerifier(config)).toBeInstanceOf(MockPaymentVerifier);
  });

  it("rejects modes missing required connection settings", () => {
    for (const { verification, message } of [
      { verification: { mode: "external-cli" as const }, message: "externalCliCommand is required" },
      { verification: { mode: "lightwalletd" as const }, message: "lightwalletdUrl is required" }
    ]) {
      expect(() => createPaymentVerifier(makeConfig(verification))).toThrow(message);
    }
  });
});
