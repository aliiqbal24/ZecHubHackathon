import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { findMatchingLedgerPayment, normalizeState, recordPayment } from "./state.js";
import { zecToZats } from "./money.js";
import { createDefaultAgentWalletSafety } from "./safety.js";
import type { VendorOrder, ZecGuardState } from "./types.js";

describe("payment ledger", () => {
  it("matches vendor orders by order, vendor, amount, address, and memo", () => {
    const quote = {
      quoteId: "q_123",
      vendorUrl: "http://localhost:3020",
      vendorName: "Vendor",
      itemId: "ai-brief",
      itemTitle: "AI brief",
      amountZec: "0.003",
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      terms: [],
      requiredPii: [],
      fulfillmentType: "digital" as const,
      privacy: { label: "ZEC", grade: "strong" as const, leaks: [], summary: "Private" },
      memo: "ZECGUARD:q_123:ai-brief",
      payTo: "u1vendor000000000000000000000000000000000000000000"
    };
    const order: VendorOrder = {
      orderId: "o_123",
      quote,
      status: "awaiting_payment",
      createdAt: new Date().toISOString()
    };
    const state: ZecGuardState = {
      agentWallet: {
        id: "agent-default",
        label: "Test Wallet",
        backend: "mock",
        status: "ready",
        dataDir: ".zecguard/wallets/agent-default",
        depositAddress: "u1agent",
        balanceZats: zecToZats("0.25"),
        spendableZats: zecToZats("0.25"),
        createdAt: new Date().toISOString(),
        safety: createDefaultAgentWalletSafety()
      },
      wallet: {
        mode: "mock",
        address: "u1agent",
        balanceZats: zecToZats("0.25"),
        spentTodayZats: 0,
        spentMonthZats: 0
      },
      purchases: [],
      activity: [],
      vendorOrders: [order],
      paymentLedger: []
    };

    recordPayment(state, {
      txId: "mock-zec-123",
      amountZec: quote.amountZec,
      amountZats: zecToZats(quote.amountZec),
      payTo: quote.payTo,
      memo: quote.memo,
      submittedAt: new Date().toISOString(),
      walletMode: "mock",
      purchaseId: "p_123",
      orderId: order.orderId,
      vendorUrl: quote.vendorUrl
    });

    expect(findMatchingLedgerPayment(state, order)?.txId).toBe("mock-zec-123");
  });

  it("migrates legacy wallet state into agentWallet", () => {
    const normalized = withConfig("mock", () => normalizeState({
      wallet: {
        mode: "mock",
        address: "u1legacyagent",
        balanceZats: zecToZats("0.12"),
        spentTodayZats: 0,
        spentMonthZats: 0,
        balanceSource: "mock",
        balanceUpdatedAt: "2026-01-01T00:00:00.000Z"
      },
      purchases: [],
      activity: [],
      vendorOrders: [],
      paymentLedger: []
    }));

    expect(normalized.agentWallet.backend).toBe("mock");
    expect(normalized.agentWallet.depositAddress).toBe("u1legacyagent");
    expect(normalized.agentWallet.balanceZats).toBe(zecToZats("0.12"));
    expect(normalized.wallet.address).toBe("u1legacyagent");
  });

  it("clears a mock deposit address when switching to zingo-cli", () => {
    const normalized = withConfig("zingo-cli", () => normalizeState({
      agentWallet: {
        id: "agent-default",
        label: "Test Wallet",
        backend: "mock",
        status: "ready",
        dataDir: ".zecguard/wallets/agent-default",
        depositAddress: "u1mockagent",
        balanceZats: zecToZats("0.25"),
        spendableZats: zecToZats("0.25"),
        createdAt: "2026-01-01T00:00:00.000Z",
        safety: createDefaultAgentWalletSafety()
      },
      wallet: {
        mode: "mock",
        address: "u1mockagent",
        balanceZats: zecToZats("0.25"),
        spentTodayZats: 0,
        spentMonthZats: 0
      },
      purchases: [],
      activity: [],
      vendorOrders: [],
      paymentLedger: []
    }));

    expect(normalized.agentWallet.backend).toBe("zingo-cli");
    expect(normalized.agentWallet.depositAddress).toBeUndefined();
    expect(normalized.agentWallet.balanceZats).toBe(0);
    expect(normalized.agentWallet.status).toBe("not_created");
  });

  it("does not treat the legacy configured walletAddress as a zingo deposit address", () => {
    const normalized = withConfig("zingo-cli", () => normalizeState({
      agentWallet: {
        id: "agent-default",
        label: "Test Wallet",
        backend: "zingo-cli",
        status: "waiting_for_funding",
        dataDir: ".zecguard/wallets/agent-default",
        depositAddress: "u1test",
        balanceZats: 0,
        spendableZats: 0,
        createdAt: "2026-01-01T00:00:00.000Z",
        safety: createDefaultAgentWalletSafety()
      },
      purchases: [],
      activity: [],
      vendorOrders: [],
      paymentLedger: []
    }));

    expect(normalized.agentWallet.depositAddress).toBeUndefined();
    expect(normalized.agentWallet.status).toBe("not_created");
  });
});

function withConfig<T>(backend: "mock" | "zingo-cli", fn: () => T): T {
  const previousConfig = process.env.ZECGUARD_CONFIG;
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "zecguard-state-test-"));
  process.env.ZECGUARD_CONFIG = path.join(tempDir, "config.yaml");
  fs.writeFileSync(
    process.env.ZECGUARD_CONFIG,
    [
      "agent:",
      "  name: Test",
      "  walletMode: mock",
      "  walletAddress: u1test",
      "agentWallet:",
      `  backend: ${backend}`,
      "  label: Test Wallet",
      "  walletId: agent-default",
      "  zingoCliPath: zingo-cli",
      "  maxRealWalletBalanceZec: \"0.05\"",
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
      ""
    ].join("\n")
  );
  try {
    return fn();
  } finally {
    if (previousConfig === undefined) {
      delete process.env.ZECGUARD_CONFIG;
    } else {
      process.env.ZECGUARD_CONFIG = previousConfig;
    }
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}
