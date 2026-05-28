import { createHmac, timingSafeEqual } from "node:crypto";
import type { PrivateReceipt } from "./types.js";

const DEFAULT_SECRET = "zecguard-demo-receipt-secret";

function secret(): string {
  return process.env.ZECGUARD_RECEIPT_SECRET ?? DEFAULT_SECRET;
}

function receiptPayload(receipt: Omit<PrivateReceipt, "signature">): string {
  return JSON.stringify({
    amountZec: receipt.amountZec,
    fulfilledAt: receipt.fulfilledAt,
    orderId: receipt.orderId,
    quoteId: receipt.quoteId,
    receiptId: receipt.receiptId,
    summary: receipt.summary,
    txId: receipt.txId,
    vendorUrl: receipt.vendorUrl
  });
}

export function signReceipt(receipt: Omit<PrivateReceipt, "signature">): PrivateReceipt {
  const signature = createHmac("sha256", secret()).update(receiptPayload(receipt)).digest("hex");
  return { ...receipt, signature };
}

export function verifyReceipt(receipt: PrivateReceipt): boolean {
  const { signature, ...unsigned } = receipt;
  const expected = createHmac("sha256", secret()).update(receiptPayload(unsigned)).digest("hex");
  return timingSafeEqual(Buffer.from(signature, "hex"), Buffer.from(expected, "hex"));
}
