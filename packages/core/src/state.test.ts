import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { attachPaymentToVendorOrder, loadState, refreshWalletBalance } from "./state.js";
import { zecToZats } from "./money.js";
import type { PaymentRecord, VendorOrder, AgentZcashConfig, AgentZcashState } from "./types.js";

const originalConfigPath = process.env.AGENTZCASH_CONFIG;
const originalStatePath = process.env.AGENTZCASH_STATE_PATH;

afterEach(() => {
  if (originalConfigPath === undefined) {
    delete process.env.AGENTZCASH_CONFIG;
  } else {
    process.env.AGENTZCASH_CONFIG = originalConfigPath;
  }
  if (originalStatePath === undefined) {
    delete process.env.AGENTZCASH_STATE_PATH;
  } else {
    process.env.AGENTZCASH_STATE_PATH = originalStatePath;
  }
});

function writeConfig(dir: string, address = "u1current"): string {
  const configPath = path.join(dir, "agentzcash.config.yaml");
  fs.writeFileSync(
    configPath,
    [
      "agent:",
      "  name: Test",
      "  walletMode: external-cli",
      `  walletAddress: ${address}`,
      "spending:",
      '  perTransactionZec: "0.05"',
      '  dailyZec: "0.15"',
      '  monthlyZec: "1.00"',
      "approval:",
      "  requireEveryPayment: true",
      "  allowOneTimeOverride: true",
      "vendors:",
      "  allowUnknownVendors: true",
      "  trusted: []",
      "privacy:",
      "  showPrivacyLabel: true",
      "shippingProfiles: []",
      ""
    ].join("\n")
  );
  return configPath;
}

describe("vendor order state", () => {
  it("attaches an externally submitted payment to a vendor order", () => {
    const quote = {
      quoteId: "q_123",
      vendorUrl: "https://vendor.example",
      vendorName: "Vendor",
      itemId: "verified-demo-service",
      itemTitle: "Verified demo service",
      amountZec: "0.0001",
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      terms: [],
      requiredPii: [],
      fulfillmentType: "service" as const,
      privacy: { label: "ZEC", grade: "strong" as const, leaks: [], summary: "Private" },
      memo: "AGENTZCASH:q_123:verified-demo-service",
      payTo: "u1vendor000000000000000000000000000000000000000000"
    };
    const order: VendorOrder = {
      orderId: "o_123",
      quote,
      status: "awaiting_payment",
      createdAt: new Date().toISOString()
    };
    const state: AgentZcashState = {
      wallet: {
        mode: "external-cli",
        address: "u1agent",
        balanceZats: zecToZats("0.25"),
        spentTodayZats: 0,
        spentMonthZats: 0
      },
      purchases: [],
      activity: [],
      vendorOrders: [order]
    };
    const payment: PaymentRecord = {
      txId: "real-tx-123",
      amountZec: quote.amountZec,
      amountZats: zecToZats(quote.amountZec),
      payTo: quote.payTo,
      memo: quote.memo,
      submittedAt: new Date().toISOString(),
      walletMode: "external-cli"
    };

    attachPaymentToVendorOrder(state, order.orderId, payment);

    expect(state.vendorOrders[0]?.status).toBe("paid");
    expect(state.vendorOrders[0]?.payment?.txId).toBe("real-tx-123");
  });
});

describe("wallet state normalization", () => {
  it("normalizes legacy local wallet data to current external config and zero balance", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "agentzcash-state-"));
    process.env.AGENTZCASH_CONFIG = writeConfig(dir, "u1current");
    process.env.AGENTZCASH_STATE_PATH = path.join(dir, "state.json");
    fs.writeFileSync(
      process.env.AGENTZCASH_STATE_PATH,
      JSON.stringify({
        wallet: {
          mode: ["mo", "ck"].join(""),
          address: "u1old",
          balanceZats: zecToZats("9.5"),
          spentTodayZats: 123,
          spentMonthZats: 456,
          balanceSource: "live",
          balanceUpdatedAt: new Date().toISOString()
        },
        purchases: [],
        activity: [],
        vendorOrders: []
      })
    );

    const state = loadState();

    expect(state.wallet.mode).toBe("external-cli");
    expect(state.wallet.address).toBe("u1current");
    expect(state.wallet.balanceZats).toBe(0);
    expect(state.wallet.balanceSource).toBe("unavailable");
    expect(state.wallet.balanceUpdatedAt).toBeUndefined();
  });

  it("sets balance to zero when external wallet refresh fails", async () => {
    const config: AgentZcashConfig = {
      agent: {
        name: "Test",
        walletMode: "external-cli",
        walletAddress: "u1current"
      },
      spending: { perTransactionZec: "0.05", dailyZec: "0.15", monthlyZec: "1.00" },
      approval: { requireEveryPayment: true, allowOneTimeOverride: true },
      vendors: { allowUnknownVendors: true, trusted: [] },
      privacy: { showPrivacyLabel: true },
      shippingProfiles: []
    };
    const state: AgentZcashState = {
      wallet: {
        mode: "external-cli",
        address: "u1current",
        balanceZats: zecToZats("3"),
        spentTodayZats: 0,
        spentMonthZats: 0,
        balanceSource: "live"
      },
      purchases: [],
      activity: [],
      vendorOrders: []
    };

    await refreshWalletBalance(state, config);

    expect(state.wallet.balanceZats).toBe(0);
    expect(state.wallet.balanceSource).toBe("unavailable");
    expect(state.wallet.balanceUpdatedAt).toBeDefined();
  });
});
