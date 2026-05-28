import { describe, expect, it } from "vitest";
import { signReceipt, verifyReceipt } from "./receipt.js";

describe("receipts", () => {
  it("signs and verifies a private receipt", () => {
    const receipt = signReceipt({
      receiptId: "r1",
      orderId: "o1",
      quoteId: "q1",
      vendorUrl: "http://vendor.test",
      amountZec: "0.01",
      txId: "mock-tx",
      fulfilledAt: new Date().toISOString(),
      summary: "Delivered"
    });

    expect(verifyReceipt(receipt)).toBe(true);
  });
});
