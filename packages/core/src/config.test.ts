import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadConfig, parseConfig, readConfigText, writeConfig } from "./config.js";
import type { ZecGuardConfig } from "./types.js";

const previousConfigPath = process.env.ZECGUARD_CONFIG;

function baseConfig(overrides: Partial<ZecGuardConfig> = {}): ZecGuardConfig {
  return {
    agent: {
      name: "Test Agent",
      walletMode: "mock",
      walletAddress: "u1testwallet000000000000000000000000000000000000000"
    },
    agentWallet: {
      backend: "mock",
      label: "Test Agent Wallet",
      walletId: "agent-default",
      zingoCliPath: "zingo-cli",
      maxRealWalletBalanceZec: "0.05"
    },
    spending: {
      perTransactionZec: "0.05",
      dailyZec: "0.15",
      monthlyZec: "1.00"
    },
    approval: {
      requireEveryPayment: true,
      allowOneTimeOverride: true
    },
    vendors: {
      allowUnknownVendors: true,
      trusted: ["http://localhost:3020"]
    },
    privacy: {
      showPrivacyLabel: true
    },
    shippingProfiles: [],
    verification: {
      mode: "mock",
      minConfirmations: 1
    },
    ...overrides
  };
}

describe("config", () => {
  beforeEach(() => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "zecguard-config-"));
    process.env.ZECGUARD_CONFIG = path.join(dir, "zecguard.config.yaml");
  });

  afterEach(() => {
    if (previousConfigPath === undefined) {
      delete process.env.ZECGUARD_CONFIG;
    } else {
      process.env.ZECGUARD_CONFIG = previousConfigPath;
    }
  });

  it("parses and writes a valid config", () => {
    const written = writeConfig(baseConfig());
    const loaded = loadConfig();

    expect(written.agent.name).toBe("Test Agent");
    expect(loaded.spending.perTransactionZec).toBe("0.05");
    expect(readConfigText()).toContain("perTransactionZec: \"0.05\"");
  });

  it("rejects invalid spending limits", () => {
    const config = baseConfig({
      spending: {
        perTransactionZec: "not-zec",
        dailyZec: "0.15",
        monthlyZec: "1.00"
      }
    });

    expect(() => parseConfig(config)).toThrow();
  });

  it("rejects invalid vendor URLs", () => {
    const config = baseConfig({
      vendors: {
        allowUnknownVendors: true,
        trusted: ["localhost:3020"]
      }
    });

    expect(() => parseConfig(config)).toThrow();
  });

  it("rejects unknown wallet presets", () => {
    const config = baseConfig();
    config.agent.walletPreset = "unknown" as ZecGuardConfig["agent"]["walletPreset"];

    expect(() => parseConfig(config)).toThrow();
  });

  it("defaults missing verification confirmations to 1", () => {
    const config = baseConfig();
    config.verification = { mode: "mock" } as ZecGuardConfig["verification"];

    expect(parseConfig(config).verification?.minConfirmations).toBe(1);
  });

  it("rejects an invalid main return address", () => {
    const config = baseConfig({
      agentWallet: {
        backend: "mock",
        label: "Test Agent Wallet",
        walletId: "agent-default",
        zingoCliPath: "zingo-cli",
        mainReturnAddress: "not-an-address",
        maxRealWalletBalanceZec: "0.05"
      }
    });

    expect(() => parseConfig(config)).toThrow();
  });
});
