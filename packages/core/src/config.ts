import fs from "node:fs";
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
