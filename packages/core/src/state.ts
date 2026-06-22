import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { getStatePath, loadConfig } from "./config.js";
import { createWalletAdapter } from "./wallet.js";
import type {
  ActivityEvent,
  PaymentRecord,
  Purchase,
  TransactionInfo,
  VendorOrder,
  AgentZcashConfig,
  AgentZcashState
} from "./types.js";

function statePath(): string {
  return getStatePath();
}

export function createInitialState(): AgentZcashState {
  const config = loadConfig();

  return {
    wallet: {
      mode: config.agent.walletMode,
      address: config.agent.walletAddress,
      balanceZats: 0,
      spentTodayZats: 0,
        spentMonthZats: 0,
        balanceSource: "unavailable",
        balanceUpdatedAt: new Date().toISOString(),
        backup: {}
    },
    purchases: [],
    activity: [
      {
        id: randomUUID(),
        timestamp: new Date().toISOString(),
        kind: "system",
        title: "AgentZcash initialized",
        detail: "External wallet configured. Balance will update on next query."
      }
    ],
    vendorOrders: []
  };
}

export function loadState(): AgentZcashState {
  const file = statePath();
  if (!fs.existsSync(file)) {
    const initial = createInitialState();
    saveState(initial);
    return initial;
  }

  return normalizeState(JSON.parse(fs.readFileSync(file, "utf8")) as Partial<AgentZcashState>);
}

export function saveState(state: AgentZcashState): void {
  const file = statePath();
  recalculateWalletSpend(state);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(state, null, 2)}\n`);
}

export function updateState(mutator: (state: AgentZcashState) => void): AgentZcashState {
  const state = loadState();
  mutator(state);
  recalculateWalletSpend(state);
  saveState(state);
  return state;
}

export function appendActivity(
  state: AgentZcashState,
  event: Omit<ActivityEvent, "id" | "timestamp">
): void {
  state.activity.unshift({
    id: randomUUID(),
    timestamp: new Date().toISOString(),
    ...event
  });
  state.activity = state.activity.slice(0, 80);
}

export function upsertPurchase(state: AgentZcashState, purchase: Purchase): void {
  const index = state.purchases.findIndex((item) => item.id === purchase.id);
  if (index >= 0) {
    state.purchases[index] = purchase;
  } else {
    state.purchases.unshift(purchase);
  }
}

export function upsertVendorOrder(state: AgentZcashState, order: VendorOrder): void {
  const index = state.vendorOrders.findIndex((item) => item.orderId === order.orderId);
  if (index >= 0) {
    state.vendorOrders[index] = order;
  } else {
    state.vendorOrders.unshift(order);
  }
}

export function attachPaymentToVendorOrder(state: AgentZcashState, orderId: string, payment: PaymentRecord): void {
  const order = state.vendorOrders.find((item) => item.orderId === orderId);
  if (!order) {
    return;
  }

  order.status = "paid";
  order.payment = payment;
  order.paidAt = new Date().toISOString();
}

export async function refreshWalletBalance(state: AgentZcashState, config: AgentZcashConfig): Promise<void> {
  const adapter = createWalletAdapter(config);
  try {
    const balanceZats = await adapter.getBalance();
    state.wallet.balanceZats = balanceZats;
    state.wallet.balanceSource = "live";
    state.wallet.balanceUpdatedAt = new Date().toISOString();
  } catch {
    state.wallet.balanceZats = 0;
    state.wallet.balanceSource = "unavailable";
    state.wallet.balanceUpdatedAt = new Date().toISOString();
  }
}

export async function refreshPendingDirectTransferConfirmations(
  state: AgentZcashState,
  config: AgentZcashConfig
): Promise<boolean> {
  const pending = state.purchases.filter(
    (purchase) =>
      purchase.kind === "direct_transfer" &&
      purchase.payment &&
      (purchase.status === "payment_submitted" || purchase.status === "pending_confirmation")
  );
  if (!pending.length) return false;

  const adapter = createWalletAdapter(config);
  const minConfirmations = config.verification?.minConfirmations ?? 1;
  let changed = false;

  for (const purchase of pending) {
    if (!purchase.payment) continue;
    const txInfo = await adapter.checkTransaction(purchase.payment.txId);
    changed = applyDirectTransferConfirmation(state, purchase, txInfo, minConfirmations) || changed;
  }

  return changed;
}

export function applyDirectTransferConfirmation(
  state: AgentZcashState,
  purchase: Purchase,
  txInfo: TransactionInfo,
  minConfirmations: number
): boolean {
  if (purchase.kind !== "direct_transfer" || !purchase.payment || !purchase.directTransfer) {
    return false;
  }

  const now = new Date().toISOString();
  const wasConfirmed = purchase.status === "receipted";
  const confirmed = txInfo.confirmations >= minConfirmations;

  purchase.paymentReceipt ??= {
    receiptId: `receipt_${purchase.id}`,
    kind: "direct_transfer",
    recipientName: purchase.directTransfer.recipientName,
    payTo: purchase.payTo,
    amountZec: purchase.amountZec,
    memo: purchase.memo,
    purpose: purchase.directTransfer.purpose,
    evidenceUrls: purchase.directTransfer.evidenceUrls,
    txId: purchase.payment.txId,
    submittedAt: purchase.payment.submittedAt,
    summary: `${purchase.amountZec} ZEC submitted to ${purchase.directTransfer.recipientName}.`
  };

  purchase.paymentReceipt.confirmationStatus = confirmed ? "confirmed" : txInfo.status;
  purchase.paymentReceipt.confirmations = txInfo.confirmations;
  purchase.paymentReceipt.blockHeight = txInfo.blockHeight;
  purchase.paymentReceipt.lastCheckedAt = now;

  if (confirmed) {
    purchase.status = "receipted";
    purchase.paymentReceipt.confirmedAt ??= now;
    purchase.paymentReceipt.summary = `${purchase.amountZec} ZEC confirmed to ${purchase.directTransfer.recipientName}.`;
    if (!wasConfirmed) {
      appendActivity(state, {
        kind: "receipt",
        title: "Direct transfer confirmed",
        detail: `${purchase.payment.txId} reached ${txInfo.confirmations} confirmation${txInfo.confirmations === 1 ? "" : "s"}.`,
        purchaseId: purchase.id
      });
    }
  } else {
    purchase.status = "pending_confirmation";
  }

  purchase.updatedAt = now;
  return true;
}

function normalizeState(state: Partial<AgentZcashState>): AgentZcashState {
  const initial = createInitialState();
  return {
    ...initial,
    ...state,
    wallet: {
      ...(state.wallet ?? {}),
      mode: initial.wallet.mode,
      address: initial.wallet.address,
      balanceZats: 0,
      spentTodayZats: state.wallet?.spentTodayZats ?? initial.wallet.spentTodayZats,
      spentMonthZats: state.wallet?.spentMonthZats ?? initial.wallet.spentMonthZats,
      balanceSource: "unavailable",
      balanceUpdatedAt: undefined,
      syncStatus: state.wallet?.syncStatus,
      backup: state.wallet?.backup ?? initial.wallet.backup
    },
    purchases: state.purchases ?? [],
    activity: state.activity ?? initial.activity,
    vendorOrders: state.vendorOrders ?? []
  };
}

function recalculateWalletSpend(state: AgentZcashState): void {
  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  const month = now.toISOString().slice(0, 7);

  const payments = state.purchases.flatMap((purchase) => (purchase.payment ? [purchase.payment] : []));
  state.wallet.spentTodayZats = payments
    .filter((payment) => payment.submittedAt.slice(0, 10) === today)
    .reduce((sum, payment) => sum + payment.amountZats, 0);
  state.wallet.spentMonthZats = payments
    .filter((payment) => payment.submittedAt.slice(0, 7) === month)
    .reduce((sum, payment) => sum + payment.amountZats, 0);
}
