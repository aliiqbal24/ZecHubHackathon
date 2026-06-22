import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { getManagedWalletDir } from "./paths.js";
import { zatsToZec, zecToZats } from "./money.js";
import type {
  PaymentRecord,
  Purchase,
  TransactionInfo,
  WalletPreset,
  WalletPresetName,
  AgentZcashConfig,
  AgentZcashState
} from "./types.js";

const execFileAsync = promisify(execFile);

export const WALLET_PRESETS: Record<WalletPresetName, WalletPreset> = {
  zodl: {
    name: "zodl",
    label: "Zodl (Zallet RPC)",
    sendCommandTemplate: "zallet rpc z_sendmany 'null' '[{\"address\":\"{to}\",\"amount\":{amount},\"memo\":\"{memoHex}\"}]'",
    balanceCommand: "zallet rpc z_gettotalbalance",
    transactionCheckCommandTemplate: "zallet rpc gettransaction '\"{txId}\"'"
  },
  "zingo-cli": {
    name: "zingo-cli",
    label: "Zingo CLI",
    sendCommandTemplate: "zingo-cli --data-dir \"{walletDir}\" send '[{\"address\":\"{to}\",\"amount\":{amount},\"memo\":\"{memo}\"}]'",
    balanceCommand: "zingo-cli --data-dir \"{walletDir}\" --waitsync balance",
    transactionCheckCommandTemplate: "zingo-cli --data-dir \"{walletDir}\" notes"
  },
  zallet: {
    name: "zallet",
    label: "Zallet CLI",
    sendCommandTemplate: "zallet rpc z_sendmany 'null' '[{\"address\":\"{to}\",\"amount\":{amount},\"memo\":\"{memoHex}\"}]'",
    balanceCommand: "zallet rpc z_gettotalbalance",
    transactionCheckCommandTemplate: "zallet rpc gettransaction '\"{txId}\"'"
  }
};

export interface WalletAdapter {
  sendPayment(purchase: Purchase, state: AgentZcashState, config: AgentZcashConfig): Promise<PaymentRecord>;
  getBalance(): Promise<number>;
  checkTransaction(txId: string): Promise<TransactionInfo>;
}

export class ExternalCliWalletAdapter implements WalletAdapter {
  constructor(private readonly config: AgentZcashConfig) {}

  async sendPayment(purchase: Purchase, _state: AgentZcashState, _config: AgentZcashConfig): Promise<PaymentRecord> {
    const resolved = resolveCliCommands(this.config);
    if (!resolved.sendCommand) {
      throw new Error("No send command configured. Set agent.externalCliCommand or agent.walletPreset in agentzcash.config.yaml.");
    }

    const { command, args } = buildExternalCliInvocation(resolved.sendCommand, purchase);

    let stdout: string;
    try {
      const result = await execFileAsync(command, args, { timeout: 120_000 });
      stdout = result.stdout;
    } catch (err: unknown) {
      throw parseCliError(err, command);
    }

    const txId = stdout.trim().split(/\s+/).at(-1);
    if (!txId || txId.length < 8) {
      throw new Error(`Wallet command succeeded but returned no valid transaction ID. Output: ${stdout.slice(0, 200)}`);
    }

    return {
      txId,
      amountZec: purchase.amountZec,
      amountZats: purchase.amountZats,
      payTo: purchase.payTo,
      memo: purchase.memo,
      submittedAt: new Date().toISOString(),
      walletMode: "external-cli"
    };
  }

  async getBalance(): Promise<number> {
    const resolved = resolveCliCommands(this.config);
    if (!resolved.balanceCommand) {
      throw new Error("No balance command configured. Set agent.externalCliBalanceCommand or agent.walletPreset in agentzcash.config.yaml.");
    }

    const tokens = tokenizeCommand(resolved.balanceCommand);
    const [command, ...args] = tokens;
    if (!command) throw new Error("Balance command is empty.");

    let stdout: string;
    try {
      const result = await execFileAsync(command, args, { timeout: 30_000 });
      stdout = result.stdout;
    } catch (err: unknown) {
      throw parseCliError(err, command);
    }

    return parseBalanceOutput(stdout);
  }

  async checkTransaction(txId: string): Promise<TransactionInfo> {
    const resolved = resolveCliCommands(this.config);
    if (!resolved.txCheckCommand) {
      return { txId, status: "pending", confirmations: 0 };
    }

    const raw = resolved.txCheckCommand.replaceAll("{txId}", txId);
    const tokens = tokenizeCommand(raw);
    const [command, ...args] = tokens;
    if (!command) return { txId, status: "pending", confirmations: 0 };

    try {
      const { stdout } = await execFileAsync(command, args, { timeout: 30_000 });
      return parseTransactionOutput(txId, stdout);
    } catch {
      return { txId, status: "not_found", confirmations: 0 };
    }
  }
}

export function resolveCliCommands(config: AgentZcashConfig): {
  sendCommand: string | undefined;
  balanceCommand: string | undefined;
  txCheckCommand: string | undefined;
} {
  const preset = config.agent.walletPreset ? WALLET_PRESETS[config.agent.walletPreset] : undefined;
  return {
    sendCommand: expandWalletTemplate(config.agent.externalCliCommand ?? preset?.sendCommandTemplate),
    balanceCommand: expandWalletTemplate(config.agent.externalCliBalanceCommand ?? preset?.balanceCommand),
    txCheckCommand: expandWalletTemplate(config.agent.externalCliTxCheckCommand ?? preset?.transactionCheckCommandTemplate)
  };
}

function expandWalletTemplate(value: string | undefined): string | undefined {
  return value?.replaceAll("{walletDir}", getManagedWalletDir());
}

export function parseCliError(err: unknown, command: string): Error {
  if (!(err instanceof Error)) return new Error(`Wallet command failed: ${String(err)}`);

  const msg = err.message.toLowerCase();
  const stderr = (err as NodeJS.ErrnoException & { stderr?: string }).stderr?.toLowerCase() ?? "";
  const combined = `${msg} ${stderr}`;

  if (combined.includes("insufficient") || combined.includes("not enough")) {
    return new Error(`Insufficient funds in wallet. The wallet "${command}" reported the balance is too low for this payment.`);
  }
  if (combined.includes("econnrefused") || combined.includes("connection refused")) {
    return new Error(`Cannot connect to wallet. Is "${command}" running? Connection was refused.`);
  }
  if (combined.includes("enoent") || combined.includes("not found")) {
    return new Error(`Wallet command "${command}" not found. Is it installed and in your PATH?`);
  }
  if (combined.includes("timeout") || combined.includes("etimedout")) {
    return new Error(`Wallet command "${command}" timed out after 120 seconds. The node may be syncing or unresponsive.`);
  }

  const exitCode = (err as { code?: number | string }).code;
  if (exitCode !== undefined) {
    return new Error(`Wallet command "${command}" exited with code ${exitCode}. ${stderr.slice(0, 300)}`);
  }

  return new Error(`Wallet command failed: ${err.message}`);
}

export function parseBalanceOutput(stdout: string): number {
  const trimmed = stdout.trim();

  if (trimmed.startsWith("{")) {
    try {
      const json = JSON.parse(trimmed) as Record<string, string>;
      const value = json.private ?? json.total ?? json.balance;
      if (value !== undefined) return zecToZats(value);
    } catch { /* fall through */ }
  }

  const match = trimmed.match(/(\d+\.\d{1,8})/);
  if (match?.[1]) return zecToZats(match[1]);

  throw new Error(`Cannot parse wallet balance from output: ${trimmed.slice(0, 200)}`);
}

export function parseTransactionOutput(txId: string, stdout: string): TransactionInfo {
  const trimmed = stdout.trim();

  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      const parsed = JSON.parse(trimmed);
      const obj = Array.isArray(parsed) ? parsed[0] : parsed;
      if (obj && typeof obj === "object") {
        const confirmations = Number(obj.confirmations ?? 0);
        return {
          txId,
          status: confirmations > 0 ? "confirmed" : "pending",
          confirmations,
          blockHeight: obj.block_height ?? obj.blockheight ?? obj.height
        };
      }
    } catch { /* fall through */ }
  }

  const confMatch = trimmed.match(/confirmations[:\s]+(\d+)/i);
  if (confMatch) {
    const confirmations = Number(confMatch[1]);
    return {
      txId,
      status: confirmations > 0 ? "confirmed" : "pending",
      confirmations
    };
  }

  return { txId, status: trimmed.length > 0 ? "pending" : "not_found", confirmations: 0 };
}

export async function waitForConfirmation(
  adapter: WalletAdapter,
  txId: string,
  minConfirmations: number,
  maxAttempts: number,
  intervalMs: number
): Promise<TransactionInfo> {
  for (let i = 0; i < maxAttempts; i++) {
    const info = await adapter.checkTransaction(txId);
    if (info.confirmations >= minConfirmations) {
      return { ...info, status: "confirmed" };
    }
    if (info.status === "not_found") return info;
    if (i < maxAttempts - 1) {
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
  }
  return { txId, status: "pending", confirmations: 0 };
}

export function buildExternalCliInvocation(
  template: string,
  purchase: Pick<Purchase, "payTo" | "amountZats" | "memo">
): { command: string; args: string[] } {
  const amount = zatsToZec(purchase.amountZats);
  const rawTokens = tokenizeCommand(template);
  const [command, ...baseArgs] = rawTokens;

  if (!command) {
    throw new Error("externalCliCommand is empty.");
  }

  const replacements: Record<string, string> = {
    "{to}": purchase.payTo,
    "{amount}": amount,
    "{memo}": purchase.memo,
    "{memoHex}": Buffer.from(purchase.memo, "utf8").toString("hex")
  };
  const hasPlaceholders = baseArgs.some((arg) => Object.keys(replacements).some((key) => arg.includes(key)));

  if (hasPlaceholders) {
    return {
      command,
      args: baseArgs.map((arg) =>
        Object.entries(replacements).reduce((value, [key, replacement]) => value.replaceAll(key, replacement), arg)
      )
    };
  }

  return {
    command,
    args: [...baseArgs, "--to", purchase.payTo, "--amount", amount, "--memo", purchase.memo]
  };
}

function tokenizeCommand(command: string): string[] {
  const tokens: string[] = [];
  let current = "";
  let quote: "'" | "\"" | null = null;

  for (const char of command.trim()) {
    if ((char === "'" || char === "\"") && quote === null) {
      quote = char;
      continue;
    }
    if (char === quote) {
      quote = null;
      continue;
    }
    if (/\s/.test(char) && quote === null) {
      if (current) {
        tokens.push(current);
        current = "";
      }
      continue;
    }
    current += char;
  }

  if (current) {
    tokens.push(current);
  }

  return tokens;
}

export function createWalletAdapter(config: AgentZcashConfig): WalletAdapter {
  if (config.agent.walletMode === "external-cli") {
    return new ExternalCliWalletAdapter(config);
  }
  throw new Error("Only external wallet mode is enabled. Configure agent.walletMode: external-cli.");
}

export function parseReceiveAddressOutput(stdout: string): string {
  const trimmed = stdout.trim();
  if (!trimmed) {
    throw new Error("Wallet returned no address output.");
  }

  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      const parsed = JSON.parse(trimmed);
      const candidates = Array.isArray(parsed) ? parsed : Object.values(parsed);
      for (const candidate of candidates) {
        if (typeof candidate === "string" && looksLikeZcashAddress(candidate)) return candidate;
        if (candidate && typeof candidate === "object") {
          for (const value of Object.values(candidate)) {
            if (typeof value === "string" && looksLikeZcashAddress(value)) return value;
          }
        }
      }
    } catch {
      // Fall through to text parsing.
    }
  }

  const match = trimmed.match(/\b(u1|zs|ztestsapling|t1|t3)[a-zA-Z0-9]{20,}\b/);
  if (match?.[0]) return match[0];

  throw new Error(`Cannot parse wallet receive address from output: ${trimmed.slice(0, 200)}`);
}

export function looksLikeZcashAddress(address: string): boolean {
  return /^(u1|utest|zs|ztestsapling|t1|t3)[a-zA-Z0-9]{20,}$/.test(address);
}

export function looksLikeShieldedZcashAddress(address: string): boolean {
  return /^(u1|utest|zs|ztestsapling)[a-zA-Z0-9]{20,}$/.test(address);
}
