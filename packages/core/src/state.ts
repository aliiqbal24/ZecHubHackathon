import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { getZecGuardHome, loadConfig } from "./config.js";
import { zecToZats } from "./money.js";
import type { ActivityEvent, PaymentLedgerEntry, PaymentRecord, Purchase, VendorOrder, ZecGuardState } from "./types.js";

const INITIAL_BALANCE_ZEC = "0.25";

function statePath(): string {
  return process.env.ZECGUARD_STATE_PATH ?? path.join(getZecGuardHome(), "state.json");
}

export function createInitialState(): ZecGuardState {
  const config = loadConfig();
  return {
    wallet: {
      mode: config.agent.walletMode,
      address: config.agent.walletAddress,
      balanceZats: zecToZats(INITIAL_BALANCE_ZEC),
      spentTodayZats: 0,
      spentMonthZats: 0
    },
    purchases: [],
    activity: [
      {
        id: randomUUID(),
        timestamp: new Date().toISOString(),
        kind: "system",
        title: "ZecGuard initialized",
        detail: "Mock agent wallet funded for local prototype."
      }
    ],
    vendorOrders: [],
    paymentLedger: []
  };
}

export function loadState(): ZecGuardState {
  const file = statePath();
  if (!fs.existsSync(file)) {
    const initial = createInitialState();
    saveState(initial);
    return initial;
  }

  return normalizeState(JSON.parse(fs.readFileSync(file, "utf8")) as Partial<ZecGuardState>);
}

export function saveState(state: ZecGuardState): void {
  const file = statePath();
  recalculateWalletSpend(state);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(state, null, 2)}\n`);
}

export function updateState(mutator: (state: ZecGuardState) => void): ZecGuardState {
  const state = loadState();
  mutator(state);
  recalculateWalletSpend(state);
  saveState(state);
  return state;
}

export function appendActivity(
  state: ZecGuardState,
  event: Omit<ActivityEvent, "id" | "timestamp">
): void {
  state.activity.unshift({
    id: randomUUID(),
    timestamp: new Date().toISOString(),
    ...event
  });
  state.activity = state.activity.slice(0, 80);
}

export function upsertPurchase(state: ZecGuardState, purchase: Purchase): void {
  const index = state.purchases.findIndex((item) => item.id === purchase.id);
  if (index >= 0) {
    state.purchases[index] = purchase;
  } else {
    state.purchases.unshift(purchase);
  }
}

export function upsertVendorOrder(state: ZecGuardState, order: VendorOrder): void {
  const index = state.vendorOrders.findIndex((item) => item.orderId === order.orderId);
  if (index >= 0) {
    state.vendorOrders[index] = order;
  } else {
    state.vendorOrders.unshift(order);
  }
}

export function attachPaymentToVendorOrder(state: ZecGuardState, orderId: string, payment: PaymentRecord): void {
  const order = state.vendorOrders.find((item) => item.orderId === orderId);
  if (!order) {
    return;
  }

  order.status = "paid";
  order.payment = payment;
  order.paidAt = new Date().toISOString();
}

export function recordPayment(
  state: ZecGuardState,
  entry: Omit<PaymentLedgerEntry, "recordedAt">
): PaymentLedgerEntry {
  const ledgerEntry = {
    ...entry,
    recordedAt: new Date().toISOString()
  };
  state.paymentLedger.unshift(ledgerEntry);
  state.paymentLedger = state.paymentLedger.slice(0, 200);
  return ledgerEntry;
}

export function findMatchingLedgerPayment(state: ZecGuardState, order: VendorOrder): PaymentLedgerEntry | undefined {
  return state.paymentLedger.find(
    (payment) =>
      payment.orderId === order.orderId &&
      payment.vendorUrl === order.quote.vendorUrl &&
      payment.amountZec === order.quote.amountZec &&
      payment.payTo === order.quote.payTo &&
      payment.memo === order.quote.memo
  );
}

function normalizeState(state: Partial<ZecGuardState>): ZecGuardState {
  const initial = createInitialState();
  return {
    ...initial,
    ...state,
    wallet: {
      ...initial.wallet,
      ...state.wallet
    },
    purchases: state.purchases ?? [],
    activity: state.activity ?? initial.activity,
    vendorOrders: state.vendorOrders ?? [],
    paymentLedger: state.paymentLedger ?? []
  };
}

function recalculateWalletSpend(state: ZecGuardState): void {
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
