import { describe, expect, it } from "vitest";
import {
  buildExternalCliInvocation,
  parseBalanceOutput,
  parseCliError,
  parseReceiveAddressOutput,
  parseTransactionOutput,
  resolveCliCommands,
  WALLET_PRESETS,
  looksLikeShieldedZcashAddress
} from "./wallet.js";
import { zecToZats } from "./money.js";
import type { AgentZcashConfig } from "./types.js";

const purchase = {
  payTo: "u1vendor000000000000000000000000000000000000000000",
  amountZats: zecToZats("0.003"),
  memo: "AGENTZCASH:q_123:verified-demo-service"
};

function makeConfig(overrides: Partial<AgentZcashConfig["agent"]> = {}): AgentZcashConfig {
  return {
    agent: {
      name: "Test",
      walletMode: "external-cli",
      walletAddress: "u1test",
      ...overrides
    },
    spending: { perTransactionZec: "0.05", dailyZec: "0.15", monthlyZec: "1.00" },
    approval: { requireEveryPayment: true, allowOneTimeOverride: true },
    vendors: { allowUnknownVendors: true, trusted: [] },
    privacy: { showPrivacyLabel: true },
    shippingProfiles: []
  };
}

describe("external wallet invocation", () => {
  it("fills placeholders without shell interpolation", () => {
    const result = buildExternalCliInvocation("zingo-cli send --recipient {to} --value {amount} --memo {memo}", purchase);
    expect(result.command).toBe("zingo-cli");
    expect(result.args).toEqual([
      "send",
      "--recipient",
      purchase.payTo,
      "--value",
      "0.003",
      "--memo",
      purchase.memo
    ]);
  });

  it("falls back to generic appended flags", () => {
    const result = buildExternalCliInvocation("wallet-cli send", purchase);
    expect(result).toEqual({
      command: "wallet-cli",
      args: ["send", "--to", purchase.payTo, "--amount", "0.003", "--memo", purchase.memo]
    });
  });

  it("fills memoHex placeholder for zcash-cli", () => {
    const result = buildExternalCliInvocation("zcash-cli z_sendmany {memoHex}", purchase);
    const expectedHex = Buffer.from(purchase.memo, "utf8").toString("hex");
    expect(result.args).toContain(expectedHex);
  });
});

describe("wallet presets", () => {
  it("resolves zodl preset commands via zallet rpc", () => {
    const config = makeConfig({ walletPreset: "zodl" });
    const resolved = resolveCliCommands(config);
    expect(resolved.sendCommand).toContain("zallet rpc z_sendmany");
    expect(resolved.balanceCommand).toBe("zallet rpc z_gettotalbalance");
    expect(resolved.txCheckCommand).toContain("zallet rpc gettransaction");
  });

  it("resolves zingo-cli preset commands", () => {
    const config = makeConfig({ walletPreset: "zingo-cli" });
    const resolved = resolveCliCommands(config);
    expect(resolved.sendCommand).toContain("zingo-cli");
    expect(resolved.sendCommand).toContain("--data-dir");
    expect(resolved.balanceCommand).toContain("--waitsync balance");
    expect(resolved.txCheckCommand).toContain("zingo-cli");
  });

  it("resolves zallet preset commands", () => {
    const config = makeConfig({ walletPreset: "zallet" });
    const resolved = resolveCliCommands(config);
    expect(resolved.sendCommand).toContain("zallet rpc z_sendmany");
    expect(resolved.balanceCommand).toBe("zallet rpc z_gettotalbalance");
  });

  it("explicit command overrides preset", () => {
    const config = makeConfig({
      walletPreset: "zingo-cli",
      externalCliCommand: "custom-send {to} {amount}"
    });
    const resolved = resolveCliCommands(config);
    expect(resolved.sendCommand).toBe("custom-send {to} {amount}");
    expect(resolved.balanceCommand).toContain("--waitsync balance");
  });

  it("returns undefined when no preset and no explicit command", () => {
    const config = makeConfig({});
    const resolved = resolveCliCommands(config);
    expect(resolved.sendCommand).toBeUndefined();
    expect(resolved.balanceCommand).toBeUndefined();
    expect(resolved.txCheckCommand).toBeUndefined();
  });

  it("all presets are defined", () => {
    expect(Object.keys(WALLET_PRESETS)).toEqual(["zodl", "zingo-cli", "zallet"]);
  });
});

describe("parseReceiveAddressOutput", () => {
  it("parses unified address from text", () => {
    expect(parseReceiveAddressOutput("Address 0: u1abcdefghijklmnopqrstuvwxyz1234567890\n")).toMatch(/^u1/);
  });

  it("parses address from JSON object", () => {
    expect(parseReceiveAddressOutput('{"address":"u1abcdefghijklmnopqrstuvwxyz1234567890"}')).toMatch(/^u1/);
  });
});

describe("address classification", () => {
  it("accepts shielded-capable addresses for direct transfers", () => {
    expect(looksLikeShieldedZcashAddress("u1abcdefghijklmnopqrstuvwxyz1234567890")).toBe(true);
    expect(looksLikeShieldedZcashAddress("utestabcdefghijklmnopqrstuvwxyz1234567890")).toBe(true);
    expect(looksLikeShieldedZcashAddress("zsabcdefghijklmnopqrstuvwxyz1234567890")).toBe(true);
    expect(looksLikeShieldedZcashAddress("ztestsaplingabcdefghijklmnopqrstuvwxyz1234567890")).toBe(true);
  });

  it("rejects transparent-only addresses for direct transfers", () => {
    expect(looksLikeShieldedZcashAddress("t1abcdefghijklmnopqrstuvwxyz1234567890")).toBe(false);
    expect(looksLikeShieldedZcashAddress("t3abcdefghijklmnopqrstuvwxyz1234567890")).toBe(false);
  });
});

describe("parseCliError", () => {
  it("identifies insufficient funds", () => {
    const err = Object.assign(new Error("Error: Insufficient funds available"), { stderr: "" });
    const parsed = parseCliError(err, "zingo-cli");
    expect(parsed.message).toContain("Insufficient funds");
  });

  it("identifies connection refused", () => {
    const err = Object.assign(new Error("connect ECONNREFUSED 127.0.0.1:8232"), { stderr: "" });
    const parsed = parseCliError(err, "zcash-cli");
    expect(parsed.message).toContain("Cannot connect");
  });

  it("identifies command not found", () => {
    const err = Object.assign(new Error("spawn zingo-cli ENOENT"), { stderr: "", code: "ENOENT" });
    const parsed = parseCliError(err, "zingo-cli");
    expect(parsed.message).toContain("not found");
  });

  it("identifies timeout", () => {
    const err = Object.assign(new Error("Command timed out"), { stderr: "" });
    const parsed = parseCliError(err, "zcash-cli");
    expect(parsed.message).toContain("timed out");
  });

  it("reports exit code", () => {
    const err = Object.assign(new Error("Command failed"), { stderr: "bad argument", code: 1 });
    const parsed = parseCliError(err, "zallet");
    expect(parsed.message).toContain("exited with code 1");
  });

  it("handles non-Error input", () => {
    const parsed = parseCliError("string error", "cmd");
    expect(parsed.message).toContain("Wallet command failed");
  });
});

describe("parseBalanceOutput", () => {
  it("parses plain ZEC number", () => {
    expect(parseBalanceOutput("0.12345678\n")).toBe(12345678);
  });

  it("parses zcash-cli JSON balance", () => {
    const json = '{"transparent":"0.00000000","private":"0.50000000","total":"0.50000000"}';
    expect(parseBalanceOutput(json)).toBe(50000000);
  });

  it("parses JSON with balance field", () => {
    const json = '{"balance":"1.00000000"}';
    expect(parseBalanceOutput(json)).toBe(100000000);
  });

  it("parses number embedded in text", () => {
    expect(parseBalanceOutput("Your balance is 0.25000000 ZEC\n")).toBe(25000000);
  });

  it("throws on unparseable output", () => {
    expect(() => parseBalanceOutput("no numbers here")).toThrow("Cannot parse wallet balance");
  });
});

describe("parseTransactionOutput", () => {
  it("parses JSON with confirmations", () => {
    const json = '{"txid":"abc123","confirmations":5,"height":12345}';
    const result = parseTransactionOutput("abc123", json);
    expect(result.status).toBe("confirmed");
    expect(result.confirmations).toBe(5);
  });

  it("parses JSON with zero confirmations", () => {
    const json = '{"txid":"abc123","confirmations":0}';
    const result = parseTransactionOutput("abc123", json);
    expect(result.status).toBe("pending");
    expect(result.confirmations).toBe(0);
  });

  it("parses text with confirmations pattern", () => {
    const result = parseTransactionOutput("abc123", "Transaction abc123\nconfirmations: 3\n");
    expect(result.status).toBe("confirmed");
    expect(result.confirmations).toBe(3);
  });

  it("returns not_found for empty output", () => {
    const result = parseTransactionOutput("abc123", "");
    expect(result.status).toBe("not_found");
  });
});
