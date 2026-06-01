import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { zecToZats } from "./money.js";
import { approveAndPayPurchase, makeLocalPaymentPurchase, sweepAgentWallet } from "./payment.js";
import { loadState, saveState } from "./state.js";
import type { ZecGuardConfig, ZecGuardState } from "./types.js";

const config: ZecGuardConfig = {
  agent: { name: "Test", walletMode: "mock", walletAddress: "u1testwallet000000000000000000000000000000000000" },
  agentWallet: {
    backend: "mock",
    label: "Test Wallet",
    walletId: "agent-default",
    zingoCliPath: "zingo-cli",
    mainReturnAddress: "u1mainreturn000000000000000000000000000000000000"
  },
  spending: { perTransactionZec: "0.05", dailyZec: "0.15", monthlyZec: "1.00" },
  approval: { requireEveryPayment: true, allowOneTimeOverride: true },
  vendors: { allowUnknownVendors: true, trusted: [] },
  privacy: { showPrivacyLabel: true },
  shippingProfiles: [],
  verification: { mode: "mock", minConfirmations: 1 }
};

let tempDir: string;
let previousConfig: string | undefined;
let previousState: string | undefined;

function writeConfig(file: string) {
  fs.writeFileSync(
    file,
    [
      "agent:",
      "  name: Test",
      "  walletMode: mock",
      "  walletAddress: u1testwallet000000000000000000000000000000000000",
      "agentWallet:",
      "  backend: mock",
      "  label: Test Wallet",
      "  walletId: agent-default",
      "  zingoCliPath: zingo-cli",
      "  mainReturnAddress: u1mainreturn000000000000000000000000000000000000",
      "spending:",
      "  perTransactionZec: \"0.05\"",
      "  dailyZec: \"0.15\"",
      "  monthlyZec: \"1.00\"",
      "approval:",
      "  requireEveryPayment: true",
      "  allowOneTimeOverride: true",
      "vendors:",
      "  allowUnknownVendors: true",
      "  trusted: []",
      "privacy:",
      "  showPrivacyLabel: true",
      "shippingProfiles: []",
      "verification:",
      "  mode: mock",
      "  minConfirmations: 1",
      ""
    ].join("\n")
  );
}

function makeState(): ZecGuardState {
  return {
    agentWallet: {
      id: "agent-default",
      label: "Test Wallet",
      backend: "mock",
      status: "ready",
      dataDir: path.join(tempDir, "wallets", "agent-default"),
      depositAddress: config.agent.walletAddress,
      mainReturnAddress: config.agentWallet.mainReturnAddress,
      balanceZats: zecToZats("0.25"),
      spendableZats: zecToZats("0.25"),
      balanceUpdatedAt: new Date().toISOString(),
      createdAt: new Date().toISOString()
    },
    wallet: {
      mode: "mock",
      address: config.agent.walletAddress,
      balanceZats: zecToZats("0.25"),
      spentTodayZats: 0,
      spentMonthZats: 0
    },
    purchases: [],
    activity: [],
    vendorOrders: [],
    paymentLedger: []
  };
}

describe("generic payments", () => {
  beforeEach(() => {
    previousConfig = process.env.ZECGUARD_CONFIG;
    previousState = process.env.ZECGUARD_STATE_PATH;
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "zecguard-payment-"));
    process.env.ZECGUARD_CONFIG = path.join(tempDir, "config.yaml");
    process.env.ZECGUARD_STATE_PATH = path.join(tempDir, "state.json");
    writeConfig(process.env.ZECGUARD_CONFIG);
  });

  afterEach(() => {
    if (previousConfig === undefined) {
      delete process.env.ZECGUARD_CONFIG;
    } else {
      process.env.ZECGUARD_CONFIG = previousConfig;
    }
    if (previousState === undefined) {
      delete process.env.ZECGUARD_STATE_PATH;
    } else {
      process.env.ZECGUARD_STATE_PATH = previousState;
    }
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("approves a prepared generic payment and stores a local receipt", async () => {
    const state = makeState();
    const purchase = makeLocalPaymentPurchase({
      amountZec: "0.003",
      payTo: "u1recipient0000000000000000000000000000000000000000",
      memo: "invoice 123",
      recipientLabel: "Report Vendor",
      config,
      state
    });
    state.purchases = [purchase];
    saveState(state);

    const result = await approveAndPayPurchase(config, { purchaseId: purchase.id, approvedBy: "mcp" });
    const saved = loadState().purchases[0];

    expect(result.purchase.status).toBe("receipted");
    expect(result.localReceipt?.txId).toBe(result.payment.txId);
    expect(saved?.localReceipt?.amountZec).toBe("0.003");
    expect(loadState().paymentLedger).toHaveLength(1);
  });

  it("does not submit the same purchase twice", async () => {
    const state = makeState();
    const purchase = makeLocalPaymentPurchase({
      amountZec: "0.003",
      payTo: "u1recipient0000000000000000000000000000000000000000",
      memo: "invoice 123",
      config,
      state
    });
    state.purchases = [purchase];
    saveState(state);

    await approveAndPayPurchase(config, { purchaseId: purchase.id, approvedBy: "mcp" });
    await expect(approveAndPayPurchase(config, { purchaseId: purchase.id, approvedBy: "mcp" })).rejects.toThrow(
      "already paid"
    );
  });

  it("blocks payment when the agent wallet is underfunded", async () => {
    const state = makeState();
    state.agentWallet.balanceZats = zecToZats("0.001");
    state.agentWallet.spendableZats = zecToZats("0.001");
    const purchase = makeLocalPaymentPurchase({
      amountZec: "0.003",
      payTo: "u1recipient0000000000000000000000000000000000000000",
      memo: "invoice 123",
      config,
      state
    });
    state.purchases = [purchase];
    saveState(state);

    await expect(approveAndPayPurchase(config, { purchaseId: purchase.id, approvedBy: "mcp" })).rejects.toThrow(
      "Insufficient mock wallet balance"
    );
  });

  it("blocks sweep without a main return address", async () => {
    const state = makeState();
    state.agentWallet.mainReturnAddress = undefined;
    saveState(state);
    await expect(
      sweepAgentWallet({
        ...config,
        agentWallet: { ...config.agentWallet, mainReturnAddress: undefined }
      })
    ).rejects.toThrow("mainReturnAddress");
  });

  it("sweeps mock spendable balance to the configured main return address", async () => {
    saveState(makeState());
    const result = await sweepAgentWallet(config);
    const saved = loadState();

    expect(result.payment.payTo).toBe(config.agentWallet.mainReturnAddress);
    expect(saved.agentWallet.spendableZats).toBe(0);
    expect(saved.activity[0]?.title).toBe("Agent wallet swept");
  });
});
