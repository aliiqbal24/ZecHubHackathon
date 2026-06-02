import { addressFingerprint, isLikelyZcashAddress } from "./address.js";
import { zecToZats, zatsToZec } from "./money.js";
import type { AgentWalletSafetyState, AgentWalletState, ZecGuardConfig } from "./types.js";

export interface AgentWalletSafetyReport {
  readyForRealFunding: boolean;
  statusLabel: string;
  checklist: Array<{ id: keyof AgentWalletSafetyState; label: string; complete: boolean; detail: string }>;
  blockers: string[];
  warnings: string[];
  depositAddressFingerprint?: string;
  mainReturnAddressFingerprint?: string;
  maxRealWalletBalanceZec: string;
  walletDataDir: string;
}

export function createDefaultAgentWalletSafety(): AgentWalletSafetyState {
  return {
    backupCreated: false,
    backupStoredOffline: false,
    returnAddressVerified: false,
    smallTestDepositObserved: false,
    smallTestSweepCompleted: false,
    preflightPassed: false,
    readyForRealFunding: false
  };
}

export function normalizeAgentWalletSafety(
  existing: Partial<AgentWalletSafetyState> | undefined,
  wallet: Pick<AgentWalletState, "backend" | "depositAddress" | "mainReturnAddress" | "balanceZats" | "spendableZats" | "dataDir">,
  config: ZecGuardConfig,
  resetReason?: string
): AgentWalletSafetyState {
  const base = resetReason ? createDefaultAgentWalletSafety() : { ...createDefaultAgentWalletSafety(), ...existing };
  const next: AgentWalletSafetyState = {
    ...base,
    smallTestDepositObserved: base.smallTestDepositObserved || (wallet.backend === "zingo-cli" && wallet.balanceZats > 0),
    lastReturnAddressFingerprint: addressFingerprint(wallet.mainReturnAddress ?? config.agentWallet.mainReturnAddress),
    lastDepositAddressFingerprint: addressFingerprint(wallet.depositAddress),
    resetReason: resetReason ?? base.resetReason
  };
  return applySafetyReadiness(next, wallet, config);
}

export function applySafetyReadiness(
  safety: AgentWalletSafetyState,
  wallet: Pick<AgentWalletState, "backend" | "depositAddress" | "mainReturnAddress" | "balanceZats" | "spendableZats" | "dataDir">,
  config: ZecGuardConfig
): AgentWalletSafetyState {
  const report = buildAgentWalletSafetyReport({ ...wallet, safety } as AgentWalletState, config);
  safety.readyForRealFunding = report.readyForRealFunding;
  safety.lastReturnAddressFingerprint = report.mainReturnAddressFingerprint;
  safety.lastDepositAddressFingerprint = report.depositAddressFingerprint;
  return safety;
}

export function buildAgentWalletSafetyReport(wallet: AgentWalletState, config: ZecGuardConfig): AgentWalletSafetyReport {
  const safety = wallet.safety ?? createDefaultAgentWalletSafety();
  const maxBalanceZats = zecToZats(config.agentWallet.maxRealWalletBalanceZec);
  const hasReturnAddress = isLikelyZcashAddress(config.agentWallet.mainReturnAddress);
  const hasDepositAddress = isLikelyZcashAddress(wallet.depositAddress);
  const capOk = wallet.spendableZats <= maxBalanceZats;
  const isReal = wallet.backend === "zingo-cli";

  const checklist: AgentWalletSafetyReport["checklist"] = [
    {
      id: "backupCreated",
      label: "Backup created",
      complete: !isReal || safety.backupCreated,
      detail: isReal ? "Confirm the wallet backup or recovery phrase exists." : "Mock wallet does not require recovery material."
    },
    {
      id: "backupStoredOffline",
      label: "Backup stored offline",
      complete: !isReal || safety.backupStoredOffline,
      detail: isReal ? "Confirm recovery material is stored offline before funding." : "Mock wallet does not require offline storage."
    },
    {
      id: "returnAddressVerified",
      label: "Return address verified",
      complete: !isReal || (hasReturnAddress && safety.returnAddressVerified),
      detail: hasReturnAddress ? "Main wallet return address was checked by suffix." : "Configure a valid mainReturnAddress."
    },
    {
      id: "preflightPassed",
      label: "Wallet preflight passed",
      complete: !isReal || safety.preflightPassed,
      detail: safety.lastPreflightError ?? "Checks Zingo CLI, wallet data path, address parsing, and balance refresh."
    },
    {
      id: "smallTestDepositObserved",
      label: "Small test deposit observed",
      complete: !isReal || safety.smallTestDepositObserved,
      detail: "Refresh after sending only a small test deposit."
    },
    {
      id: "smallTestSweepCompleted",
      label: "Small test sweep completed",
      complete: !isReal || safety.smallTestSweepCompleted,
      detail: "Sweep the test deposit back to the main wallet from the dashboard."
    }
  ];

  const blockers = isReal
    ? checklist.filter((item) => !item.complete).map((item) => item.label)
    : [];
  if (isReal && !hasDepositAddress) blockers.push("Deposit address parsed");
  if (isReal && !capOk) {
    blockers.push(`Wallet balance cap (${config.agentWallet.maxRealWalletBalanceZec} ZEC)`);
  }

  const warnings: string[] = [];
  if (isReal && !capOk) {
    warnings.push(`Spendable balance is ${zatsToZec(wallet.spendableZats)} ZEC, above the ${config.agentWallet.maxRealWalletBalanceZec} ZEC cap. Sweep excess before approvals.`);
  }
  if (isReal && safety.resetReason) {
    warnings.push(`Safety checklist was reset: ${safety.resetReason}.`);
  }

  const readyForRealFunding = isReal && blockers.length === 0;
  return {
    readyForRealFunding,
    statusLabel: isReal ? (readyForRealFunding ? "Ready for real funding" : "Not ready to fund") : "Mock wallet",
    checklist,
    blockers,
    warnings,
    depositAddressFingerprint: addressFingerprint(wallet.depositAddress),
    mainReturnAddressFingerprint: addressFingerprint(config.agentWallet.mainReturnAddress),
    maxRealWalletBalanceZec: config.agentWallet.maxRealWalletBalanceZec,
    walletDataDir: wallet.dataDir
  };
}
