import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";
import { WALLET_PRESETS } from "./wallet.js";
import type { ZecGuardConfig } from "./types.js";

export function findWorkspaceRoot(start = process.cwd()): string {
  if (process.env.ZECGUARD_ROOT) {
    return process.env.ZECGUARD_ROOT;
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

export function getZecGuardHome(): string {
  return process.env.ZECGUARD_HOME ?? path.join(/*turbopackIgnore: true*/ findWorkspaceRoot(), ".zecguard");
}

export function getConfigPath(): string {
  return process.env.ZECGUARD_CONFIG ?? path.join(/*turbopackIgnore: true*/ findWorkspaceRoot(), "zecguard.config.yaml");
}

export function loadConfig(): ZecGuardConfig {
  const configPath = getConfigPath();
  if (!fs.existsSync(configPath)) {
    throw new Error(`Missing ZecGuard config at ${configPath}`);
  }

  const raw = YAML.parse(fs.readFileSync(configPath, "utf8")) as ZecGuardConfig;

  if (!raw.verification) {
    raw.verification = { mode: "mock", minConfirmations: 1 };
  }
  raw.verification.minConfirmations ??= 1;

  if (raw.agent.walletPreset && !WALLET_PRESETS[raw.agent.walletPreset]) {
    throw new Error(
      `Unknown walletPreset "${raw.agent.walletPreset}". Valid presets: ${Object.keys(WALLET_PRESETS).join(", ")}`
    );
  }

  return raw;
}

export function readConfigText(): string {
  return fs.readFileSync(getConfigPath(), "utf8");
}
