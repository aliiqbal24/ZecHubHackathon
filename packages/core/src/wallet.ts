import { execFile } from "node:child_process";
import fs from "node:fs";
import { promisify } from "node:util";
import { randomUUID } from "node:crypto";
import { zatsToZec, zecToZats } from "./money.js";
import { loadState } from "./state.js";
import type {
  AgentWalletState,
  PaymentRecord,
  Purchase,
  TransactionInfo,
  WalletPreset,
  WalletPresetName,
  ZecGuardConfig,
  ZecGuardState
} from "./types.js";

const execFileAsync = promisify(execFile);
type ExecFileRunner = (command: string, args: string[], options: { timeout: number }) => Promise<{ stdout: string; stderr: string }>;

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
    sendCommandTemplate: "zingo-cli send '[{\"address\":\"{to}\",\"amount\":{amount},\"memo\":\"{memo}\"}]'",
    balanceCommand: "zingo-cli balance",
    transactionCheckCommandTemplate: "zingo-cli notes"
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
  sendPayment(purchase: Purchase, state: ZecGuardState, config: ZecGuardConfig): Promise<PaymentRecord>;
  getBalance(): Promise<number>;
  checkTransaction(txId: string): Promise<TransactionInfo>;
}

export interface AgentWalletAdapter {
  checkAvailability(): Promise<{ available: boolean; detail?: string }>;
  createAgentWallet(state: ZecGuardState): Promise<AgentWalletState>;
  getDepositAddress(state: ZecGuardState): Promise<string>;
  refreshBalance(state: ZecGuardState): Promise<AgentWalletState>;
  sendPayment(purchase: Purchase, state: ZecGuardState, config: ZecGuardConfig): Promise<PaymentRecord>;
  sweepToMain(state: ZecGuardState, mainReturnAddress: string): Promise<PaymentRecord>;
}

export class MockWalletAdapter implements WalletAdapter {
  async sendPayment(purchase: Purchase, state: ZecGuardState, config: ZecGuardConfig): Promise<PaymentRecord> {
    if (state.wallet.balanceZats < purchase.amountZats) {
      throw new Error("Mock wallet balance is too low for this purchase.");
    }

    return {
      txId: `mock-zec-${randomUUID()}`,
      amountZec: purchase.amountZec,
      amountZats: purchase.amountZats,
      payTo: purchase.payTo,
      memo: purchase.memo,
      submittedAt: new Date().toISOString(),
      walletMode: config.agent.walletMode
    };
  }

  async getBalance(): Promise<number> {
    return loadState().wallet.balanceZats;
  }

  async checkTransaction(txId: string): Promise<TransactionInfo> {
    return { txId, status: "confirmed", confirmations: 100 };
  }
}

export class MockAgentWalletAdapter implements AgentWalletAdapter {
  async checkAvailability(): Promise<{ available: boolean; detail?: string }> {
    return { available: true };
  }

  async createAgentWallet(state: ZecGuardState): Promise<AgentWalletState> {
    state.agentWallet.status = "ready";
    state.agentWallet.depositAddress ??= state.wallet.address;
    state.agentWallet.lastError = undefined;
    return state.agentWallet;
  }

  async getDepositAddress(state: ZecGuardState): Promise<string> {
    if (!state.agentWallet.depositAddress) {
      await this.createAgentWallet(state);
    }
    return state.agentWallet.depositAddress ?? state.wallet.address;
  }

  async refreshBalance(state: ZecGuardState): Promise<AgentWalletState> {
    state.agentWallet.status = "ready";
    state.agentWallet.balanceUpdatedAt = new Date().toISOString();
    state.agentWallet.lastError = undefined;
    return state.agentWallet;
  }

  async sendPayment(purchase: Purchase, state: ZecGuardState, _config: ZecGuardConfig): Promise<PaymentRecord> {
    if (state.agentWallet.spendableZats < purchase.amountZats) {
      throw new Error("Mock agent wallet balance is too low for this purchase.");
    }

    return {
      txId: `mock-zec-${randomUUID()}`,
      amountZec: purchase.amountZec,
      amountZats: purchase.amountZats,
      payTo: purchase.payTo,
      memo: purchase.memo,
      submittedAt: new Date().toISOString(),
      walletMode: "mock"
    };
  }

  async sweepToMain(state: ZecGuardState, mainReturnAddress: string): Promise<PaymentRecord> {
    if (state.agentWallet.spendableZats <= 0) {
      throw new Error("Mock agent wallet has no spendable balance to sweep.");
    }

    return {
      txId: `mock-sweep-${randomUUID()}`,
      amountZec: zatsToZec(state.agentWallet.spendableZats),
      amountZats: state.agentWallet.spendableZats,
      payTo: mainReturnAddress,
      memo: "ZecGuard agent wallet sweep",
      submittedAt: new Date().toISOString(),
      walletMode: "mock"
    };
  }
}

export class ZingoCliAgentWalletAdapter implements AgentWalletAdapter {
  constructor(
    private readonly config: ZecGuardConfig,
    private readonly runner: ExecFileRunner = execFileAsync as ExecFileRunner
  ) {}

  async checkAvailability(): Promise<{ available: boolean; detail?: string }> {
    try {
      await this.runner(this.cliPath, ["--help"], { timeout: 10_000 });
      return { available: true };
    } catch (err) {
      const parsed = parseCliError(err, this.cliPath);
      return { available: false, detail: parsed.message };
    }
  }

  async createAgentWallet(state: ZecGuardState): Promise<AgentWalletState> {
    fs.mkdirSync(state.agentWallet.dataDir, { recursive: true });
    const address = await this.getDepositAddress(state);
    state.agentWallet.depositAddress = address;
    state.agentWallet.status = state.agentWallet.spendableZats > 0 ? "ready" : "waiting_for_funding";
    state.agentWallet.lastError = undefined;
    return state.agentWallet;
  }

  async getDepositAddress(state: ZecGuardState): Promise<string> {
    const { command, args } = buildZingoCliInvocation({
      cliPath: this.cliPath,
      dataDir: state.agentWallet.dataDir,
      serverUrl: this.config.agentWallet.zingoServerUrl,
      command: "addresses"
    });

    try {
      const { stdout } = await this.runner(command, args, { timeout: 60_000 });
      return parseZingoAddressOutput(stdout);
    } catch (err) {
      throw parseCliError(err, command);
    }
  }

  async refreshBalance(state: ZecGuardState): Promise<AgentWalletState> {
    if (!state.agentWallet.depositAddress) {
      await this.createAgentWallet(state);
    }

    const { command, args } = buildZingoCliInvocation({
      cliPath: this.cliPath,
      dataDir: state.agentWallet.dataDir,
      serverUrl: this.config.agentWallet.zingoServerUrl,
      waitSync: true,
      command: "balance"
    });

    try {
      const { stdout } = await this.runner(command, args, { timeout: 120_000 });
      const balance = parseZingoBalanceOutput(stdout);
      state.agentWallet.balanceZats = balance.balanceZats;
      state.agentWallet.spendableZats = balance.spendableZats;
      state.agentWallet.balanceUpdatedAt = new Date().toISOString();
      state.agentWallet.status = balance.spendableZats > 0 ? "ready" : "waiting_for_funding";
      state.agentWallet.lastError = undefined;
      return state.agentWallet;
    } catch (err) {
      state.agentWallet.status = "error";
      state.agentWallet.lastError = parseCliError(err, command).message;
      throw new Error(state.agentWallet.lastError);
    }
  }

  async sendPayment(purchase: Purchase, state: ZecGuardState, _config: ZecGuardConfig): Promise<PaymentRecord> {
    if (state.agentWallet.spendableZats < purchase.amountZats) {
      throw new Error(`Insufficient agent wallet balance: ${zatsToZec(state.agentWallet.spendableZats)} ZEC spendable, ${purchase.amountZec} ZEC needed.`);
    }

    const txId = await this.sendZingoTransfer(state, purchase.payTo, purchase.amountZats, purchase.memo);
    return {
      txId,
      amountZec: purchase.amountZec,
      amountZats: purchase.amountZats,
      payTo: purchase.payTo,
      memo: purchase.memo,
      submittedAt: new Date().toISOString(),
      walletMode: "zingo-cli"
    };
  }

  async sweepToMain(state: ZecGuardState, mainReturnAddress: string): Promise<PaymentRecord> {
    const feeZats = zecToZats("0.0001");
    const amountZats = state.agentWallet.spendableZats - feeZats;
    if (amountZats <= 0) {
      throw new Error("Agent wallet spendable balance is too low to sweep after reserving a network fee.");
    }

    const memo = "ZecGuard agent wallet sweep";
    const txId = await this.sendZingoTransfer(state, mainReturnAddress, amountZats, memo);
    return {
      txId,
      amountZec: zatsToZec(amountZats),
      amountZats,
      payTo: mainReturnAddress,
      memo,
      submittedAt: new Date().toISOString(),
      walletMode: "zingo-cli"
    };
  }

  private async sendZingoTransfer(state: ZecGuardState, to: string, amountZats: number, memo: string): Promise<string> {
    const paymentJson = JSON.stringify([{ address: to, amount: zatsToZec(amountZats), memo }]);
    const { command, args } = buildZingoCliInvocation({
      cliPath: this.cliPath,
      dataDir: state.agentWallet.dataDir,
      serverUrl: this.config.agentWallet.zingoServerUrl,
      waitSync: true,
      command: "send",
      commandArgs: [paymentJson]
    });

    try {
      const { stdout } = await this.runner(command, args, { timeout: 120_000 });
      return parseZingoTxId(stdout);
    } catch (err) {
      throw parseCliError(err, command);
    }
  }

  private get cliPath(): string {
    return this.config.agentWallet.zingoCliPath ?? "zingo-cli";
  }
}

export class ExternalCliWalletAdapter implements WalletAdapter {
  constructor(private readonly config: ZecGuardConfig) {}

  async sendPayment(purchase: Purchase, _state: ZecGuardState, _config: ZecGuardConfig): Promise<PaymentRecord> {
    const resolved = resolveCliCommands(this.config);
    if (!resolved.sendCommand) {
      throw new Error("No send command configured. Set agent.externalCliCommand or agent.walletPreset in zecguard.config.yaml.");
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
      throw new Error("No balance command configured. Set agent.externalCliBalanceCommand or agent.walletPreset in zecguard.config.yaml.");
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

export function resolveCliCommands(config: ZecGuardConfig): {
  sendCommand: string | undefined;
  balanceCommand: string | undefined;
  txCheckCommand: string | undefined;
} {
  const preset = config.agent.walletPreset ? WALLET_PRESETS[config.agent.walletPreset] : undefined;
  return {
    sendCommand: config.agent.externalCliCommand ?? preset?.sendCommandTemplate,
    balanceCommand: config.agent.externalCliBalanceCommand ?? preset?.balanceCommand,
    txCheckCommand: config.agent.externalCliTxCheckCommand ?? preset?.transactionCheckCommandTemplate
  };
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

export function buildZingoCliInvocation(args: {
  cliPath: string;
  dataDir: string;
  serverUrl?: string;
  waitSync?: boolean;
  command: string;
  commandArgs?: string[];
}): { command: string; args: string[] } {
  return {
    command: args.cliPath,
    args: [
      "--data-dir",
      args.dataDir,
      ...(args.serverUrl ? ["--server", args.serverUrl] : []),
      ...(args.waitSync ? ["--waitsync"] : []),
      args.command,
      ...(args.commandArgs ?? [])
    ]
  };
}

export function parseZingoAddressOutput(stdout: string): string {
  const trimmed = stdout.trim();
  const strings = extractJsonStrings(trimmed);
  const candidates = [...strings, ...trimmed.split(/\s+/)].filter(isLikelyZcashAddress);
  const address = candidates.sort((a, b) => b.length - a.length)[0];
  if (!address) {
    throw new Error(`Cannot parse Zingo deposit address from output: ${trimmed.slice(0, 200)}`);
  }
  return address;
}

export function parseZingoBalanceOutput(stdout: string): { balanceZats: number; spendableZats: number } {
  const trimmed = stdout.trim();
  if (!trimmed) {
    throw new Error("Cannot parse Zingo balance from empty output.");
  }

  if (trimmed.startsWith("{")) {
    try {
      const parsed = JSON.parse(trimmed) as Record<string, unknown>;
      const spendable =
        numberLike(parsed.spendable_zatoshis) ??
        numberLike(parsed.spendableZats) ??
        zecLike(parsed.spendable) ??
        zecLike(parsed.available);
      const total =
        numberLike(parsed.total_zatoshis) ??
        numberLike(parsed.balance_zatoshis) ??
        numberLike(parsed.balanceZats) ??
        zecLike(parsed.total) ??
        zecLike(parsed.balance) ??
        spendable;
      if (total !== undefined || spendable !== undefined) {
        return {
          balanceZats: total ?? spendable ?? 0,
          spendableZats: spendable ?? total ?? 0
        };
      }
    } catch {
      /* fall through */
    }
  }

  const spendable =
    parseNamedZats(trimmed, /spendable[^0-9]*(\d+)\s*zatoshis/i) ??
    parseNamedZats(trimmed, /spendable[^\n:]*:\s*(\d+)/i) ??
    parseNamedZec(trimmed, /spendable[^0-9]*(\d+(?:\.\d{1,8})?)\s*zec/i);
  const total =
    parseNamedZats(trimmed, /(?:total|verified|balance)[^0-9]*(\d+)\s*zatoshis/i) ??
    parseNamedZats(trimmed, /(?:total|verified|balance)[^\n:]*:\s*(\d+)/i) ??
    parseNamedZec(trimmed, /(?:total|verified|balance)[^0-9]*(\d+(?:\.\d{1,8})?)\s*zec/i) ??
    (spendable === undefined ? parseBalanceOutput(trimmed) : undefined);

  if (total !== undefined || spendable !== undefined) {
    return {
      balanceZats: total ?? spendable ?? 0,
      spendableZats: spendable ?? total ?? 0
    };
  }

  throw new Error(`Cannot parse Zingo balance from output: ${trimmed.slice(0, 200)}`);
}

export function parseZingoTxId(stdout: string): string {
  const trimmed = stdout.trim();
  const jsonStrings = extractJsonStrings(trimmed);
  const txId = [...jsonStrings, ...trimmed.split(/\s+/)].find((token) => /^[a-f0-9]{32,64}$/i.test(token));
  if (!txId) {
    throw new Error(`Zingo send succeeded but returned no valid transaction ID. Output: ${trimmed.slice(0, 200)}`);
  }
  return txId;
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

export function createWalletAdapter(config: ZecGuardConfig): WalletAdapter {
  if (config.agent.walletMode === "external-cli") {
    return new ExternalCliWalletAdapter(config);
  }
  return new MockWalletAdapter();
}

export function createAgentWalletAdapter(config: ZecGuardConfig): AgentWalletAdapter {
  if (config.agentWallet.backend === "zingo-cli") {
    return new ZingoCliAgentWalletAdapter(config);
  }
  return new MockAgentWalletAdapter();
}

function extractJsonStrings(input: string): string[] {
  if (!input.startsWith("{") && !input.startsWith("[")) return [];
  try {
    const parsed = JSON.parse(input);
    const strings: string[] = [];
    const visit = (value: unknown) => {
      if (typeof value === "string") {
        strings.push(value);
      } else if (Array.isArray(value)) {
        value.forEach(visit);
      } else if (value && typeof value === "object") {
        Object.values(value).forEach(visit);
      }
    };
    visit(parsed);
    return strings;
  } catch {
    return [];
  }
}

function isLikelyZcashAddress(value: string): boolean {
  return /^(u1|utest|zs|ztestsapling|t1|t3|tm|tex)[a-zA-Z0-9]{20,}$/.test(value);
}

function numberLike(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return Math.trunc(value);
  if (typeof value === "string" && /^\d+$/.test(value.trim())) return Number(value);
  return undefined;
}

function zecLike(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return zecToZats(value.toFixed(8));
  if (typeof value === "string" && /^\d+(?:\.\d{1,8})?$/.test(value.trim())) return zecToZats(value);
  return undefined;
}

function parseNamedZats(input: string, regex: RegExp): number | undefined {
  const match = input.match(regex);
  return match?.[1] ? Number(match[1]) : undefined;
}

function parseNamedZec(input: string, regex: RegExp): number | undefined {
  const match = input.match(regex);
  return match?.[1] ? zecToZats(match[1]) : undefined;
}
