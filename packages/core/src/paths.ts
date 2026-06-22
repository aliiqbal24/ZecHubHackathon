import os from "node:os";
import path from "node:path";

export function getAgentZcashHome(): string {
  return process.env.AGENTZCASH_HOME ?? path.join(os.homedir(), ".agentzcash");
}

export function getConfigPath(): string {
  return process.env.AGENTZCASH_CONFIG ?? path.join(getAgentZcashHome(), "agentzcash.config.yaml");
}

export function getStatePath(): string {
  return process.env.AGENTZCASH_STATE_PATH ?? path.join(getAgentZcashHome(), "state.json");
}

export function getManagedWalletDir(): string {
  return path.join(getAgentZcashHome(), "wallet");
}
