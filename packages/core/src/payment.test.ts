import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { zecToZats } from "./money.js";
import { approveAndPayPurchase, makeLocalPaymentPurchase } from "./payment.js";
import { loadState, saveState } from "./state.js";
import type { ZecGuardConfig, ZecGuardState } from "./types.js";

const config: ZecGuardConfig = {
  agent: { name: "Test", walletMode: "mock", walletAddress: "u1testwallet000000000000000000000000000000000000" },
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
});
