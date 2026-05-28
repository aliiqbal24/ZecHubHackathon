import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { randomUUID } from "node:crypto";
import { zatsToZec } from "./money.js";
import type { PaymentRecord, Purchase, ZecGuardConfig, ZecGuardState } from "./types.js";

const execFileAsync = promisify(execFile);

export interface WalletAdapter {
  sendPayment(purchase: Purchase, state: ZecGuardState, config: ZecGuardConfig): Promise<PaymentRecord>;
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
}

export class ExternalCliWalletAdapter implements WalletAdapter {
  async sendPayment(purchase: Purchase, _state: ZecGuardState, config: ZecGuardConfig): Promise<PaymentRecord> {
    if (!config.agent.externalCliCommand) {
      throw new Error("externalCliCommand is not configured.");
    }

    const { command, args } = buildExternalCliInvocation(config.agent.externalCliCommand, purchase);
    const { stdout } = await execFileAsync(command, args, { timeout: 120_000 });
    const txId = stdout.trim().split(/\s+/).at(-1);

    if (!txId) {
      throw new Error("External wallet command did not return a transaction id.");
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
    "{memo}": purchase.memo
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
    return new ExternalCliWalletAdapter();
  }
  return new MockWalletAdapter();
}
