import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import YAML from "yaml";
import { zecGuardConfigSchema } from "./schemas.js";
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

export function getUserZecGuardHome(): string {
  const platform = process.platform;
  if (platform === "win32") {
    return path.join(process.env.APPDATA ?? path.join(os.homedir(), "AppData", "Roaming"), "ZecGuard");
  }
  if (platform === "darwin") {
    return path.join(os.homedir(), "Library", "Application Support", "ZecGuard");
  }
  return path.join(process.env.XDG_DATA_HOME ?? path.join(os.homedir(), ".local", "share"), "zecguard");
}

export function createDefaultConfig(): ZecGuardConfig {
  return parseConfig({
    agent: {
      name: "ZecGuard Agent",
      walletMode: "external-cli",
      walletAddress: "configure-in-dashboard",
      walletPreset: "zingo-cli"
    },
    agentWallet: {
      backend: "zingo-cli",
      label: "ZecGuard Agent Wallet",
      walletId: "agent-default",
      zingoCliPath: "zingo-cli",
      maxRealWalletBalanceZec: "0.05"
    },
    spending: {
      perTransactionZec: "0.05",
      dailyZec: "0.15",
      monthlyZec: "1.00"
    },
    approval: {
      requireEveryPayment: true,
      allowOneTimeOverride: true
    },
    vendors: {
      allowUnknownVendors: true,
      trusted: []
    },
    privacy: {
      showPrivacyLabel: true
    },
    verification: {
      mode: "mock",
      minConfirmations: 1
    },
    shippingProfiles: []
  });
}

export function ensureConfig(): ZecGuardConfig {
  const configPath = getConfigPath();
  if (fs.existsSync(configPath)) {
    return loadConfig();
  }
  return writeConfig(createDefaultConfig());
}

export function loadConfig(): ZecGuardConfig {
  const configPath = getConfigPath();
  if (!fs.existsSync(configPath)) {
    throw new Error(`Missing ZecGuard config at ${configPath}`);
  }

  return parseConfig(YAML.parse(fs.readFileSync(configPath, "utf8")));
}

export function readConfigText(): string {
  return fs.readFileSync(getConfigPath(), "utf8");
}

export function writeConfig(config: ZecGuardConfig): ZecGuardConfig {
  const parsed = parseConfig(config);
  const configPath = getConfigPath();
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(configPath, YAML.stringify(stripUndefined(parsed)), "utf8");
  return parsed;
}

export function parseConfig(config: unknown): ZecGuardConfig {
  return zecGuardConfigSchema.parse(config);
}

function stripUndefined<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((item) => stripUndefined(item)) as T;
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, item]) => item !== undefined)
        .map(([key, item]) => [key, stripUndefined(item)])
    ) as T;
  }
  return value;
}
