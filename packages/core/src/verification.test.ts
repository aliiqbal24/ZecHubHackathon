import { describe, expect, it } from "vitest";
import { MockPaymentVerifier, createPaymentVerifier } from "./verification.js";
import type { ZecGuardConfig } from "./types.js";

function makeConfig(verification: Partial<ZecGuardConfig["verification"]> = {}): ZecGuardConfig {
  return {
    agent: { name: "Test", walletMode: "mock", walletAddress: "u1test" },
    agentWallet: { backend: "mock", label: "Test Wallet", walletId: "agent-default", zingoCliPath: "zingo-cli" },
    spending: { perTransactionZec: "0.05", dailyZec: "0.15", monthlyZec: "1.00" },
    approval: { requireEveryPayment: true, allowOneTimeOverride: true },
    vendors: { allowUnknownVendors: true, trusted: [] },
    privacy: { showPrivacyLabel: true },
    shippingProfiles: [],
    verification: { mode: "mock", minConfirmations: 1, ...verification }
  };
}

describe("createPaymentVerifier", () => {
  it("returns MockPaymentVerifier for mock mode", () => {
    const verifier = createPaymentVerifier(makeConfig({ mode: "mock" }));
    expect(verifier).toBeInstanceOf(MockPaymentVerifier);
  });

  it("defaults to mock when no verification config", () => {
    const config = makeConfig();
    delete config.verification;
    const verifier = createPaymentVerifier(config);
    expect(verifier).toBeInstanceOf(MockPaymentVerifier);
  });

  it("throws when external-cli mode has no command", () => {
    expect(() =>
      createPaymentVerifier(makeConfig({ mode: "external-cli" }))
    ).toThrow("externalCliCommand is required");
  });

  it("creates ExternalCliVerifier with command", () => {
    const verifier = createPaymentVerifier(
      makeConfig({ mode: "external-cli", externalCliCommand: "zingo-cli list-received --memo {memo}" })
    );
    expect(verifier).toBeDefined();
  });

  it("throws when lightwalletd mode has no URL", () => {
    expect(() =>
      createPaymentVerifier(makeConfig({ mode: "lightwalletd" }))
    ).toThrow("lightwalletdUrl is required");
  });

  it("creates LightwalletVerifier with URL", () => {
    const verifier = createPaymentVerifier(
      makeConfig({ mode: "lightwalletd", lightwalletdUrl: "https://mainnet.lightwalletd.com" })
    );
    expect(verifier).toBeDefined();
  });
});
