import { describe, expect, it } from "vitest";
import { createPaymentVerifier, ExternalCliVerifier, LightwalletVerifier } from "./verification.js";
import type { AgentZcashConfig } from "./types.js";

function makeConfig(verification: Partial<AgentZcashConfig["verification"]> = {}): AgentZcashConfig {
  return {
    agent: { name: "Test", walletMode: "external-cli", walletAddress: "u1test" },
    spending: { perTransactionZec: "0.05", dailyZec: "0.15", monthlyZec: "1.00" },
    approval: { requireEveryPayment: true, allowOneTimeOverride: true },
    vendors: { allowUnknownVendors: true, trusted: [] },
    privacy: { showPrivacyLabel: true },
    shippingProfiles: [],
    verification: { mode: "external-cli", minConfirmations: 1, externalCliCommand: "zingo-cli notes", ...verification }
  };
}

describe("createPaymentVerifier", () => {
  it("requires an external verifier command by default", () => {
    const config = makeConfig();
    delete config.verification;
    expect(() => createPaymentVerifier(config)).toThrow("externalCliCommand is required");
  });

  it("throws when external-cli mode has no command", () => {
    expect(() =>
      createPaymentVerifier(makeConfig({ mode: "external-cli", externalCliCommand: undefined }))
    ).toThrow("externalCliCommand is required");
  });

  it("creates ExternalCliVerifier with command", () => {
    const verifier = createPaymentVerifier(
      makeConfig({ mode: "external-cli", externalCliCommand: "zingo-cli list-received --memo {memo}" })
    );
    expect(verifier).toBeInstanceOf(ExternalCliVerifier);
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
    expect(verifier).toBeInstanceOf(LightwalletVerifier);
  });
});
