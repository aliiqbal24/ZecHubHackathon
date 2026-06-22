import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { VerifiedPayment, VendorOrder, AgentZcashConfig } from "./types.js";

const execFileAsync = promisify(execFile);

export interface PaymentVerifier {
  verifyPayment(order: VendorOrder, txId?: string): Promise<VerifiedPayment | null>;
}

export class ExternalCliVerifier implements PaymentVerifier {
  constructor(
    private readonly cliCommand: string,
    private readonly minConfirmations: number
  ) {}

  async verifyPayment(order: VendorOrder): Promise<VerifiedPayment | null> {
    const rawCommand = this.cliCommand
      .replaceAll("{memo}", order.quote.memo)
      .replaceAll("{amount}", order.quote.amountZec)
      .replaceAll("{address}", order.quote.payTo);

    const tokens = tokenizeCommand(rawCommand);
    const [command, ...args] = tokens;
    if (!command) return null;

    try {
      const { stdout } = await execFileAsync(command, args, { timeout: 30_000 });
      return this.parseReceivedTransactions(stdout, order);
    } catch {
      return null;
    }
  }

  private parseReceivedTransactions(stdout: string, order: VendorOrder): VerifiedPayment | null {
    const trimmed = stdout.trim();
    if (trimmed.startsWith("[") || trimmed.startsWith("{")) {
      try {
        const parsed = JSON.parse(trimmed);
        const txns: Array<Record<string, unknown>> = Array.isArray(parsed) ? parsed : [parsed];
        for (const tx of txns) {
          if (this.matchesOrder(tx, order) && (Number(tx.confirmations ?? 0)) >= this.minConfirmations) {
            return {
              txId: String(tx.txid ?? tx.txId ?? tx.transaction_id ?? ""),
              amountZec: String(tx.amount ?? tx.value ?? ""),
              memo: String(tx.memo ?? ""),
              confirmations: Number(tx.confirmations ?? 0),
              blockHeight: tx.block_height != null ? Number(tx.block_height) : tx.blockheight != null ? Number(tx.blockheight) : undefined,
              matchedAt: new Date().toISOString()
            };
          }
        }
      } catch { /* fall through */ }
    }
    return null;
  }

  private matchesOrder(tx: Record<string, unknown>, order: VendorOrder): boolean {
    const memo = String(tx.memo ?? "");
    const amount = String(tx.amount ?? tx.value ?? "");
    return memo.includes(order.quote.memo) && amount === order.quote.amountZec;
  }
}

export class LightwalletVerifier implements PaymentVerifier {
  constructor(
    private readonly lightwalletdUrl: string,
    private readonly minConfirmations: number
  ) {}

  async verifyPayment(order: VendorOrder, txId?: string): Promise<VerifiedPayment | null> {
    if (!txId) return null;
    try {
      const baseUrl = this.lightwalletdUrl.replace(/\/$/, "");
      const response = await fetch(`${baseUrl}/v1/gettransaction`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ txId })
      });

      if (!response.ok) return null;

      const data = (await response.json()) as {
        height?: number;
        confirmations?: number;
      };

      const confirmations = data.confirmations ?? 0;
      if (confirmations < this.minConfirmations) return null;

      return {
        txId,
        amountZec: order.quote.amountZec,
        memo: order.quote.memo,
        confirmations,
        blockHeight: data.height,
        matchedAt: new Date().toISOString()
      };
    } catch {
      return null;
    }
  }
}

export function createPaymentVerifier(config: AgentZcashConfig): PaymentVerifier {
  const verification = config.verification ?? { mode: "external-cli" as const, minConfirmations: 1 };

  switch (verification.mode) {
    case "external-cli":
      if (!verification.externalCliCommand) {
        throw new Error("verification.externalCliCommand is required when verification mode is external-cli.");
      }
      return new ExternalCliVerifier(verification.externalCliCommand, verification.minConfirmations);

    case "lightwalletd":
      if (!verification.lightwalletdUrl) {
        throw new Error("verification.lightwalletdUrl is required when verification mode is lightwalletd.");
      }
      return new LightwalletVerifier(verification.lightwalletdUrl, verification.minConfirmations);

    default:
      throw new Error("Unsupported verification mode. Fake payment verification is disabled.");
  }
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
