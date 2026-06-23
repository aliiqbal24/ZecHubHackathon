import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";
import { getAgentZcashHome, getConfigPath, getManagedWalletDir, getStatePath } from "./paths.js";
import { WALLET_PRESETS } from "./wallet.js";
import type { AgentZcashConfig } from "./types.js";

export function findWorkspaceRoot(start = process.cwd()): string {
  if (process.env.AGENTZCASH_ROOT) {
    return process.env.AGENTZCASH_ROOT;
  }

  const parent = path.basename(path.dirname(start));
  if (parent === "apps" || parent === "packages") {
    return path.resolve(start, "../..");
  }

  if (path.basename(start) === "dist") {
    return findWorkspaceRoot(path.resolve(start, ".."));
  }

  return start;
}

export function loadConfig(): AgentZcashConfig {
  const configPath = getConfigPath();
  if (!fs.existsSync(configPath)) {
    throw new Error(`Missing AgentZcash config at ${configPath}`);
  }

  const raw = YAML.parse(fs.readFileSync(configPath, "utf8")) as Partial<AgentZcashConfig> & {
    agent?: Partial<AgentZcashConfig["agent"]> & { walletMode?: string };
    verification?: Omit<Partial<NonNullable<AgentZcashConfig["verification"]>>, "mode"> & { mode?: string };
  };

  if (raw.agent?.walletMode !== "external-cli") {
    throw new Error("Only external wallet mode is enabled. Set agent.walletMode to external-cli.");
  }

  if (!raw.verification) {
    raw.verification = { mode: "external-cli", minConfirmations: 1 };
  }
  const verificationMode = (raw.verification as { mode?: string }).mode;
  const retiredLocalMode = ["mo", "ck"].join("");
  if (verificationMode === retiredLocalMode) {
    throw new Error("Only external payment verification is enabled. Set verification.mode to external-cli.");
  }
  raw.verification.minConfirmations ??= 1;

  if (raw.agent.walletPreset && !WALLET_PRESETS[raw.agent.walletPreset]) {
    throw new Error(
      `Unknown walletPreset "${raw.agent.walletPreset}". Valid presets: ${Object.keys(WALLET_PRESETS).join(", ")}`
    );
  }

  return raw as AgentZcashConfig;
}

export function readConfigText(): string {
  return fs.readFileSync(getConfigPath(), "utf8");
}

export function saveConfig(config: AgentZcashConfig): void {
  const file = getConfigPath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, YAML.stringify(config));
}

export { getAgentZcashHome, getConfigPath, getManagedWalletDir, getStatePath };
