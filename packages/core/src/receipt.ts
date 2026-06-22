import { createHmac, timingSafeEqual } from "node:crypto";
import type { PrivateReceipt } from "./types.js";

function secret(): string {
  const value = process.env.AGENTZCASH_RECEIPT_SECRET;
  if (!value) {
    throw new Error("AGENTZCASH_RECEIPT_SECRET is required to sign or verify receipts.");
  }
  return value;
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
