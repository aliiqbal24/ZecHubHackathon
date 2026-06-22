import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { signReceipt, verifyReceipt } from "./receipt.js";

describe("receipts", () => {
  beforeEach(() => {
    process.env.AGENTZCASH_RECEIPT_SECRET = "test-receipt-secret";
  });

  afterEach(() => {
    delete process.env.AGENTZCASH_RECEIPT_SECRET;
  });

  it("signs and verifies a private receipt", () => {
    const receipt = signReceipt({
      receiptId: "r1",
      orderId: "o1",
      quoteId: "q1",
      vendorUrl: "http://vendor.test",
      amountZec: "0.01",
      txId: "real-tx",
      fulfilledAt: new Date().toISOString(),
      summary: "Delivered"
    });

    expect(verifyReceipt(receipt)).toBe(true);
  });

  it("requires an explicit receipt secret", () => {
    delete process.env.AGENTZCASH_RECEIPT_SECRET;
    expect(() =>
      signReceipt({
        receiptId: "r1",
        orderId: "o1",
        quoteId: "q1",
        vendorUrl: "http://vendor.test",
        amountZec: "0.01",
        txId: "real-tx",
        fulfilledAt: new Date().toISOString(),
        summary: "Delivered"
      })
    ).toThrow("AGENTZCASH_RECEIPT_SECRET is required");
  });
});
