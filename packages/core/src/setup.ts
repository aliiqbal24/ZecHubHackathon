import { getConfigPath, getZecGuardHome, loadConfig } from "./config.js";
import { getStatePath, loadState } from "./state.js";
import { buildAgentWalletSafetyReport, type AgentWalletSafetyReport } from "./safety.js";
import type { ZecGuardConfig, ZecGuardState } from "./types.js";

export interface ZecGuardSetupStatus {
  status: "ready" | "setup_required";
  setupRequired: boolean;
  dashboardUrl: string;
  configPath: string;
  statePath: string;
  home: string;
  blockers: string[];
  warnings: string[];
  walletDataDir: string;
  safety?: AgentWalletSafetyReport;
}

export function getDashboardUrl(): string {
  return process.env.ZECGUARD_DASHBOARD_URL ?? "http://127.0.0.1:3000";
}

export function getSetupStatus(
  config: ZecGuardConfig = loadConfig(),
  state: ZecGuardState = loadState()
): ZecGuardSetupStatus {
  if (config.agentWallet.backend === "mock") {
    return {
      status: "ready",
      setupRequired: false,
      dashboardUrl: getDashboardUrl(),
      configPath: getConfigPath(),
      statePath: getStatePath(),
      home: getZecGuardHome(),
      blockers: [],
      warnings: [],
      walletDataDir: state.agentWallet.dataDir
    };
  }

  const safety = buildAgentWalletSafetyReport(state.agentWallet, config);
  const blockers = [...safety.blockers];
  const hasZingoPath = Boolean(config.agentWallet.zingoCliPath?.trim());
  if (!hasZingoPath) blockers.unshift("Zingo CLI path configured");
  if (state.agentWallet.status === "zingo_missing") blockers.unshift("Zingo CLI available");
  if (state.agentWallet.status === "error" && state.agentWallet.lastError) blockers.unshift(state.agentWallet.lastError);

  const uniqueBlockers = [...new Set(blockers)];
  return {
    status: uniqueBlockers.length ? "setup_required" : "ready",
    setupRequired: uniqueBlockers.length > 0,
    dashboardUrl: getDashboardUrl(),
    configPath: getConfigPath(),
    statePath: getStatePath(),
    home: getZecGuardHome(),
    blockers: uniqueBlockers,
    warnings: safety.warnings,
    walletDataDir: state.agentWallet.dataDir,
    safety
  };
}

export function setupRequiredResult(config?: ZecGuardConfig, state?: ZecGuardState) {
  const setup = getSetupStatus(config, state);
  return {
    status: "setup_required" as const,
    setupRequired: true,
    message: "Complete the ZecGuard real-wallet setup wizard before preparing or approving ZEC payments.",
    dashboardUrl: setup.dashboardUrl,
    blockers: setup.blockers,
    warnings: setup.warnings,
    configPath: setup.configPath,
    walletDataDir: setup.walletDataDir
  };
}
