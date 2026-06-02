import { describe, expect, it } from "vitest";
import {
  buildExternalCliInvocation,
  buildZingoCliInvocation,
  parseBalanceOutput,
  parseCliError,
  parseZingoAddressOutput,
  parseZingoBalanceOutput,
  parseZingoTxId,
  parseTransactionOutput,
  resolveCliCommands,
  ZingoCliAgentWalletAdapter
} from "./wallet.js";
import { zecToZats } from "./money.js";
import { createDefaultAgentWalletSafety } from "./safety.js";
import type { ZecGuardConfig, ZecGuardState } from "./types.js";

const purchase = {
  payTo: "u1vendor000000000000000000000000000000000000000000",
  amountZats: zecToZats("0.003"),
  memo: "ZECGUARD:q_123:ai-brief"
};

function makeConfig(overrides: Partial<ZecGuardConfig["agent"]> = {}): ZecGuardConfig {
  return {
    agent: {
      name: "Test",
      walletMode: "external-cli",
      walletAddress: "u1test",
      ...overrides
    },
    agentWallet: {
      backend: "zingo-cli",
      label: "Test Wallet",
      walletId: "agent-default",
      zingoCliPath: "zingo-cli",
      maxRealWalletBalanceZec: "0.05"
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
    const result = buildExternalCliInvocation("mock-wallet send", purchase);
    expect(result).toEqual({
      command: "mock-wallet",
      args: ["send", "--to", purchase.payTo, "--amount", "0.003", "--memo", purchase.memo]
    });
  });

  it("fills memoHex placeholder for zcash-cli", () => {
    const result = buildExternalCliInvocation("zcash-cli z_sendmany {memoHex}", purchase);
    const expectedHex = Buffer.from(purchase.memo, "utf8").toString("hex");
    expect(result.args).toContain(expectedHex);
  });
});

describe("zingo agent wallet helpers", () => {
  it("builds data-dir server and waitsync invocation without shell interpolation", () => {
    const invocation = buildZingoCliInvocation({
      cliPath: "zingo-cli",
      dataDir: ".zecguard/wallets/agent-default",
      serverUrl: "https://lightwalletd.example",
      waitSync: true,
      command: "send",
      commandArgs: ["[]"]
    });
    expect(invocation).toEqual({
      command: "zingo-cli",
      args: [
        "--data-dir",
        ".zecguard/wallets/agent-default",
        "--server",
        "https://lightwalletd.example",
        "--waitsync",
        "send",
        "[]"
      ]
    });
  });

  it("parses a unified address from JSON output", () => {
    expect(parseZingoAddressOutput('{"unified":"u1testaddress0000000000000000000000000000"}')).toBe(
      "u1testaddress0000000000000000000000000000"
    );
  });

  it("parses an address from zingo log-prefixed output", () => {
    expect(
      parseZingoAddressOutput(
        'Launching sync task...\n[{"encoded_address":"u1w4hfhl6e9n3mxgsz8fxtkthlstpfkee9nyn4ffql4s3ew9thuf0c779kjeeuapzf2g2smzqa623tkn5p7lxt37sm53tvuuuvdc6rqv5d"}]\nZingo CLI quit successfully.'
      )
    ).toBe("u1w4hfhl6e9n3mxgsz8fxtkthlstpfkee9nyn4ffql4s3ew9thuf0c779kjeeuapzf2g2smzqa623tkn5p7lxt37sm53tvuuuvdc6rqv5d");
  });

  it("parses zingo text and JSON balances", () => {
    for (const output of [
      "verified zatoshis: 500000\nspendable zatoshis: 300000\n",
      '{"total_zatoshis":500000,"spendable_zatoshis":300000}'
    ]) {
      expect(parseZingoBalanceOutput(output)).toEqual({ balanceZats: 500000, spendableZats: 300000 });
    }
  });

  it("parses a transaction id from send output", () => {
    const txId = "ab".repeat(32);
    expect(parseZingoTxId(`sent transaction ${txId}`)).toBe(txId);
  });
});

describe("zingo agent wallet adapter", () => {
  function makeState(): ZecGuardState {
    return {
      agentWallet: {
        id: "agent-default",
        label: "Test Wallet",
        backend: "zingo-cli",
        status: "not_created",
        dataDir: ".zecguard/wallets/agent-default",
        balanceZats: 0,
        spendableZats: 0,
        createdAt: new Date().toISOString(),
        safety: createDefaultAgentWalletSafety()
      },
      wallet: {
        mode: "external-cli",
        address: "",
        balanceZats: 0,
        spentTodayZats: 0,
        spentMonthZats: 0
      },
      purchases: [],
      activity: [],
      vendorOrders: [],
      paymentLedger: []
    };
  }

  it("creates wallet by reading addresses and stores the deposit address", async () => {
    const calls: string[][] = [];
    const runner = async (_command: string, args: string[]) => {
      calls.push(args);
      return { stdout: '{"unified":"u1testaddress0000000000000000000000000000"}', stderr: "" };
    };
    const state = makeState();
    const adapter = new ZingoCliAgentWalletAdapter(makeConfig(), runner);

    await adapter.createAgentWallet(state);

    expect(calls[0]).toEqual(["--data-dir", ".zecguard/wallets/agent-default", "addresses"]);
    expect(state.agentWallet.depositAddress).toBe("u1testaddress0000000000000000000000000000");
    expect(state.agentWallet.status).toBe("waiting_for_funding");
  });

  it("refreshes balance and spendable zats", async () => {
    const runner = async () => ({ stdout: "verified zatoshis: 500000\nspendable zatoshis: 300000\n", stderr: "" });
    const state = makeState();
    state.agentWallet.depositAddress = "u1testaddress0000000000000000000000000000";
    const adapter = new ZingoCliAgentWalletAdapter(makeConfig(), runner);

    await adapter.refreshBalance(state);

    expect(state.agentWallet.balanceZats).toBe(500000);
    expect(state.agentWallet.spendableZats).toBe(300000);
    expect(state.agentWallet.status).toBe("ready");
  });

  it("sends payment with zingo-cli send JSON payload", async () => {
    const calls: string[][] = [];
    const txId = "ab".repeat(32);
    const runner = async (_command: string, args: string[]) => {
      calls.push(args);
      return { stdout: `txid ${txId}`, stderr: "" };
    };
    const state = makeState();
    state.agentWallet.spendableZats = zecToZats("0.01");
    const adapter = new ZingoCliAgentWalletAdapter(makeConfig(), runner);

    const payment = await adapter.sendPayment(
      {
        payTo: purchase.payTo,
        amountZec: "0.003",
        amountZats: purchase.amountZats,
        memo: purchase.memo
      } as never,
      state,
      makeConfig()
    );

    expect(calls[0]?.slice(0, 4)).toEqual(["--data-dir", ".zecguard/wallets/agent-default", "--waitsync", "send"]);
    expect(calls[0]?.[4]).toContain(purchase.payTo);
    expect(payment.txId).toBe(txId);
    expect(payment.walletMode).toBe("zingo-cli");
  });

  it("sweeps spendable balance minus fee to main return address", async () => {
    const txId = "cd".repeat(32);
    let payload = "";
    const runner = async (_command: string, args: string[]) => {
      payload = args.at(-1) ?? "";
      return { stdout: `txid ${txId}`, stderr: "" };
    };
    const state = makeState();
    state.agentWallet.spendableZats = zecToZats("0.01");
    const adapter = new ZingoCliAgentWalletAdapter(makeConfig(), runner);

    const payment = await adapter.sweepToMain(state, "u1main0000000000000000000000000000000000000000");

    expect(payload).toContain("0.0099");
    expect(payment.amountZats).toBe(zecToZats("0.0099"));
    expect(payment.payTo).toBe("u1main0000000000000000000000000000000000000000");
  });
});

describe("wallet presets", () => {
  it("resolves supported preset commands", () => {
    const cases = [
      { preset: "zodl" as const, send: "zallet rpc z_sendmany", balance: "zallet rpc z_gettotalbalance" },
      { preset: "zingo-cli" as const, send: "zingo-cli", balance: "zingo-cli balance" },
      { preset: "zallet" as const, send: "zallet rpc z_sendmany", balance: "zallet rpc z_gettotalbalance" }
    ];

    for (const { preset, send, balance } of cases) {
      const resolved = resolveCliCommands(makeConfig({ walletPreset: preset }));
      expect(resolved.sendCommand).toContain(send);
      expect(resolved.balanceCommand).toBe(balance);
      expect(resolved.txCheckCommand).toBeDefined();
    }
  });

  it("explicit command overrides preset", () => {
    const config = makeConfig({
      walletPreset: "zingo-cli",
      externalCliCommand: "custom-send {to} {amount}"
    });
    const resolved = resolveCliCommands(config);
    expect(resolved.sendCommand).toBe("custom-send {to} {amount}");
    expect(resolved.balanceCommand).toBe("zingo-cli balance");
  });

  it("returns no commands when no preset and no explicit command", () => {
    const config = makeConfig({});
    const resolved = resolveCliCommands(config);
    expect(resolved.sendCommand).toBeUndefined();
    expect(resolved.balanceCommand).toBeUndefined();
    expect(resolved.txCheckCommand).toBeUndefined();
  });
});

describe("parseCliError", () => {
  it("classifies common wallet command failures", () => {
    const cases = [
      {
        err: Object.assign(new Error("Error: Insufficient funds available"), { stderr: "" }),
        command: "zingo-cli",
        expected: "Insufficient funds"
      },
      {
        err: Object.assign(new Error("connect ECONNREFUSED 127.0.0.1:8232"), { stderr: "" }),
        command: "zcash-cli",
        expected: "Cannot connect"
      },
      {
        err: Object.assign(new Error("spawn zingo-cli ENOENT"), { stderr: "", code: "ENOENT" }),
        command: "zingo-cli",
        expected: "not found"
      },
      {
        err: Object.assign(new Error("Command timed out"), { stderr: "" }),
        command: "zcash-cli",
        expected: "timed out"
      },
      {
        err: Object.assign(new Error("Command failed"), { stderr: "bad argument", code: 1 }),
        command: "zallet",
        expected: "exited with code 1"
      }
    ];

    for (const { err, command, expected } of cases) {
      expect(parseCliError(err, command).message).toContain(expected);
    }
  });

  it("handles non-Error input", () => {
    const parsed = parseCliError("string error", "cmd");
    expect(parsed.message).toContain("Wallet command failed");
  });
});

describe("parseBalanceOutput", () => {
  it("parses common balance output shapes", () => {
    const cases = [
      { output: "0.12345678\n", expected: 12345678 },
      { output: '{"transparent":"0.00000000","private":"0.50000000","total":"0.50000000"}', expected: 50000000 },
      { output: '{"balance":"1.00000000"}', expected: 100000000 },
      { output: "Your balance is 0.25000000 ZEC\n", expected: 25000000 }
    ];

    for (const { output, expected } of cases) {
      expect(parseBalanceOutput(output)).toBe(expected);
    }
  });

  it("throws on unparseable output", () => {
    expect(() => parseBalanceOutput("no numbers here")).toThrow("Cannot parse wallet balance");
  });
});

describe("parseTransactionOutput", () => {
  it("maps transaction output to status and confirmation count", () => {
    const cases = [
      { output: '{"txid":"abc123","confirmations":5,"height":12345}', status: "confirmed", confirmations: 5 },
      { output: '{"txid":"abc123","confirmations":0}', status: "pending", confirmations: 0 },
      { output: "Transaction abc123\nconfirmations: 3\n", status: "confirmed", confirmations: 3 },
      { output: "", status: "not_found", confirmations: 0 }
    ] as const;

    for (const { output, status, confirmations } of cases) {
      const result = parseTransactionOutput("abc123", output);
      expect(result.status).toBe(status);
      expect(result.confirmations).toBe(confirmations);
    }
  });
});
