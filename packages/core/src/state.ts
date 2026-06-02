import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { addressFingerprint } from "./address.js";
import { getZecGuardHome, loadConfig } from "./config.js";
import { zecToZats } from "./money.js";
import { applySafetyReadiness, createDefaultAgentWalletSafety, normalizeAgentWalletSafety } from "./safety.js";
import { createAgentWalletAdapter } from "./wallet.js";
import type {
  ActivityEvent,
  AgentWalletState,
  PaymentLedgerEntry,
  PaymentRecord,
  Purchase,
  VendorOrder,
  WalletState,
  ZecGuardConfig,
  ZecGuardState
} from "./types.js";

const INITIAL_BALANCE_ZEC = "0.25";

export function getStatePath(): string {
  return process.env.ZECGUARD_STATE_PATH ?? path.join(getZecGuardHome(), "state.json");
}

function agentWalletDataDir(walletId: string): string {
  return path.join(getZecGuardHome(), "wallets", walletId);
}

export function createInitialState(): ZecGuardState {
  const config = loadConfig();
  const isMock = config.agentWallet.backend === "mock";
  const walletId = config.agentWallet.walletId ?? "agent-default";
  const now = new Date().toISOString();
  const agentWallet: AgentWalletState = {
    id: walletId,
    label: config.agentWallet.label ?? `${config.agent.name} Wallet`,
    backend: config.agentWallet.backend,
    status: isMock ? "ready" : "not_created",
    dataDir: agentWalletDataDir(walletId),
    depositAddress: isMock ? config.agent.walletAddress : undefined,
    mainReturnAddress: config.agentWallet.mainReturnAddress,
    balanceZats: isMock ? zecToZats(INITIAL_BALANCE_ZEC) : 0,
    spendableZats: isMock ? zecToZats(INITIAL_BALANCE_ZEC) : 0,
    balanceUpdatedAt: isMock ? now : undefined,
    createdAt: now,
    safety: createDefaultAgentWalletSafety()
  };
  agentWallet.safety = normalizeAgentWalletSafety(agentWallet.safety, agentWallet, config);

  return {
    agentWallet,
    wallet: legacyWalletMirror(agentWallet, undefined, isMock ? "mock" : "cached"),
    purchases: [],
    activity: [
      {
        id: randomUUID(),
        timestamp: now,
        kind: "system",
        title: "ZecGuard initialized",
        detail: isMock
          ? "Mock agent wallet funded for local prototype."
          : "Zingo agent wallet configured. Create or refresh the wallet from the dashboard."
      }
    ],
    vendorOrders: [],
    paymentLedger: []
  };
}

export function loadState(): ZecGuardState {
  const file = getStatePath();
  if (!fs.existsSync(file)) {
    const initial = createInitialState();
    saveState(initial);
    return initial;
  }

  return normalizeState(JSON.parse(fs.readFileSync(file, "utf8")) as Partial<ZecGuardState>);
}

export function saveState(state: ZecGuardState): void {
  const file = getStatePath();
  recalculateWalletSpend(state);
  syncLegacyWallet(state, state.wallet.balanceSource);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(state, null, 2)}\n`);
}

export function updateState(mutator: (state: ZecGuardState) => void): ZecGuardState {
  const state = loadState();
  mutator(state);
  recalculateWalletSpend(state);
  syncLegacyWallet(state, state.wallet.balanceSource);
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

export async function refreshWalletBalance(state: ZecGuardState, config: ZecGuardConfig): Promise<void> {
  if (config.agentWallet.backend === "mock") return;

  const adapter = createAgentWalletAdapter(config);
  try {
    if (!state.agentWallet.depositAddress) {
      await adapter.createAgentWallet(state);
    }
    await adapter.refreshBalance(state);
    state.agentWallet.safety.smallTestDepositObserved =
      state.agentWallet.safety.smallTestDepositObserved || state.agentWallet.balanceZats > 0;
    state.agentWallet.safety.lastPreflightError = undefined;
    applySafetyReadiness(state.agentWallet.safety, state.agentWallet, config);
    syncLegacyWallet(state, "live");
  } catch (err) {
    state.agentWallet.status = isZingoMissingError(err) ? "zingo_missing" : "error";
    state.agentWallet.lastError = err instanceof Error ? err.message : String(err);
    state.agentWallet.safety.lastPreflightError = state.agentWallet.lastError;
    state.agentWallet.safety.preflightPassed = false;
    applySafetyReadiness(state.agentWallet.safety, state.agentWallet, config);
    syncLegacyWallet(state, "cached");
  }
}

export async function runAgentWalletPreflight(state: ZecGuardState, config: ZecGuardConfig): Promise<void> {
  if (config.agentWallet.backend === "mock") {
    state.agentWallet.safety.preflightPassed = true;
    state.agentWallet.safety.lastPreflightError = undefined;
    state.agentWallet.safety.preflightCheckedAt = new Date().toISOString();
    applySafetyReadiness(state.agentWallet.safety, state.agentWallet, config);
    return;
  }

  const adapter = createAgentWalletAdapter(config);
  try {
    const availability = await adapter.checkAvailability();
    if (!availability.available) {
      throw new Error(availability.detail ?? "Zingo CLI is not available.");
    }
    if (!state.agentWallet.depositAddress) {
      await adapter.createAgentWallet(state);
    }
    if (!fs.existsSync(state.agentWallet.dataDir)) {
      throw new Error(`Wallet data directory does not exist: ${state.agentWallet.dataDir}`);
    }
    await adapter.refreshBalance(state);
    state.agentWallet.safety.preflightPassed = true;
    state.agentWallet.safety.preflightCheckedAt = new Date().toISOString();
    state.agentWallet.safety.lastPreflightError = undefined;
    state.agentWallet.safety.smallTestDepositObserved =
      state.agentWallet.safety.smallTestDepositObserved || state.agentWallet.balanceZats > 0;
    applySafetyReadiness(state.agentWallet.safety, state.agentWallet, config);
  } catch (err) {
    state.agentWallet.status = isZingoMissingError(err) ? "zingo_missing" : "error";
    state.agentWallet.lastError = err instanceof Error ? err.message : String(err);
    state.agentWallet.safety.preflightPassed = false;
    state.agentWallet.safety.preflightCheckedAt = new Date().toISOString();
    state.agentWallet.safety.lastPreflightError = state.agentWallet.lastError;
    applySafetyReadiness(state.agentWallet.safety, state.agentWallet, config);
    throw err;
  }
}

export function normalizeState(state: Partial<ZecGuardState>): ZecGuardState {
  const initial = createInitialState();
  const migratedAgentWallet = normalizeAgentWallet(state, initial);
  const normalized: ZecGuardState = {
    ...initial,
    ...state,
    agentWallet: migratedAgentWallet,
    wallet: {
      ...legacyWalletMirror(migratedAgentWallet, state.wallet),
      ...state.wallet,
      address: migratedAgentWallet.depositAddress ?? state.wallet?.address ?? initial.wallet.address,
      balanceZats: migratedAgentWallet.balanceZats,
      balanceUpdatedAt: migratedAgentWallet.balanceUpdatedAt ?? state.wallet?.balanceUpdatedAt
    },
    purchases: state.purchases ?? [],
    activity: state.activity ?? initial.activity,
    vendorOrders: state.vendorOrders ?? [],
    paymentLedger: state.paymentLedger ?? []
  };
  recalculateWalletSpend(normalized);
  syncLegacyWallet(normalized, normalized.wallet.balanceSource);
  return normalized;
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

export function syncLegacyWallet(state: ZecGuardState, balanceSource = state.wallet.balanceSource): void {
  state.wallet = legacyWalletMirror(state.agentWallet, state.wallet, balanceSource);
}

function legacyWalletMirror(
  agentWallet: AgentWalletState,
  previous?: Partial<WalletState>,
  balanceSource: WalletState["balanceSource"] = agentWallet.backend === "mock" ? "mock" : "cached"
): WalletState {
  return {
    mode: agentWallet.backend === "mock" ? "mock" : "external-cli",
    address: agentWallet.depositAddress ?? previous?.address ?? "",
    balanceZats: agentWallet.balanceZats,
    spentTodayZats: previous?.spentTodayZats ?? 0,
    spentMonthZats: previous?.spentMonthZats ?? 0,
    balanceSource,
    balanceUpdatedAt: agentWallet.balanceUpdatedAt ?? previous?.balanceUpdatedAt
  };
}

function normalizeAgentWallet(state: Partial<ZecGuardState>, initial: ZecGuardState): AgentWalletState {
  const config = loadConfig();
  const legacy = state.wallet;
  const existing = state.agentWallet;
  const walletId = existing?.id ?? config.agentWallet.walletId ?? "agent-default";
  const configuredBackend = config.agentWallet.backend ?? (legacy?.mode === "mock" ? "mock" : "zingo-cli");
  const backend = existing?.backend === configuredBackend ? existing.backend : configuredBackend;
  const switchingBackend = existing?.backend !== undefined && existing.backend !== backend;
  const balanceZats = switchingBackend
    ? initial.agentWallet.balanceZats
    : existing?.balanceZats ?? legacy?.balanceZats ?? initial.agentWallet.balanceZats;
  const spendableZats = switchingBackend ? initial.agentWallet.spendableZats : existing?.spendableZats ?? balanceZats;
  const candidateDepositAddress = switchingBackend
    ? initial.agentWallet.depositAddress
    : existing?.depositAddress ?? legacy?.address ?? initial.agentWallet.depositAddress;
  const staleLegacyDeposit = backend === "zingo-cli" && candidateDepositAddress === config.agent.walletAddress;
  const depositAddress = staleLegacyDeposit ? undefined : candidateDepositAddress;
  const configuredReturnAddress = config.agentWallet.mainReturnAddress;
  const existingReturnAddress = existing?.mainReturnAddress;
  const walletSettingsChanged = [
    switchingBackend ? "wallet backend changed" : undefined,
    staleLegacyDeposit ? "legacy mock address was removed from real wallet state" : undefined,
    existing?.id !== undefined && existing.id !== walletId ? "wallet id changed" : undefined,
    existing?.mainReturnAddress !== undefined && existingReturnAddress !== configuredReturnAddress ? "main return address changed" : undefined,
    existing?.safety?.lastReturnAddressFingerprint &&
    existing.safety.lastReturnAddressFingerprint !== addressFingerprint(configuredReturnAddress)
      ? "return address fingerprint changed"
      : undefined,
    existing?.safety?.lastDepositAddressFingerprint &&
    depositAddress &&
    existing.safety.lastDepositAddressFingerprint !== addressFingerprint(depositAddress)
      ? "deposit address changed"
      : undefined
  ].find((reason): reason is string => Boolean(reason));

  const normalized: AgentWalletState = {
    ...initial.agentWallet,
    ...existing,
    id: walletId,
    label: existing?.label ?? config.agentWallet.label ?? initial.agentWallet.label,
    backend,
    status:
      (switchingBackend || staleLegacyDeposit ? undefined : existing?.status) ??
      (backend === "mock" ? "ready" : depositAddress ? (spendableZats > 0 ? "ready" : "waiting_for_funding") : "not_created"),
    dataDir: existing?.dataDir ?? agentWalletDataDir(walletId),
    depositAddress,
    mainReturnAddress: config.agentWallet.mainReturnAddress ?? existing?.mainReturnAddress,
    balanceZats,
    spendableZats,
    balanceUpdatedAt: switchingBackend
      ? initial.agentWallet.balanceUpdatedAt
      : existing?.balanceUpdatedAt ?? legacy?.balanceUpdatedAt ?? initial.agentWallet.balanceUpdatedAt,
    createdAt: existing?.createdAt ?? initial.agentWallet.createdAt,
    safety: createDefaultAgentWalletSafety()
  };
  normalized.safety = normalizeAgentWalletSafety(existing?.safety, normalized, config, walletSettingsChanged);
  return normalized;
}

function isZingoMissingError(err: unknown): boolean {
  return err instanceof Error && /not found|enoent/i.test(err.message);
}
