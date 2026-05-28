import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";
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

  return YAML.parse(fs.readFileSync(configPath, "utf8")) as ZecGuardConfig;
}

export function readConfigText(): string {
  return fs.readFileSync(getConfigPath(), "utf8");
}
