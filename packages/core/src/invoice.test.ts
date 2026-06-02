import { describe, expect, it } from "vitest";
import { extractZecInvoices, invoicesAreStable, parseZcashPaymentUri } from "./invoice.js";

const address = "u1invoiceextract0000000000000000000000000000000000000000";

describe("ZEC invoice extraction", () => {
  it("parses a ZIP-321 URI", () => {
    const invoice = parseZcashPaymentUri(`zcash:${address}?amount=0.003&memo=order-123`);

    expect(invoice.payTo).toBe(address);
    expect(invoice.amountZec).toBe("0.003");
    expect(invoice.memo).toBe("order-123");
  });

  it("extracts visible address, amount, memo, and expiry text", () => {
    const invoices = extractZecInvoices(`
      Pay to ${address}
      Amount: 0.004 ZEC
      Memo: checkout-456
      Expires at: 2030-01-01T00:00:00Z
    `);

    expect(invoices).toHaveLength(1);
    expect(invoices[0]?.payTo).toBe(address);
    expect(invoices[0]?.amountZec).toBe("0.004");
    expect(invoices[0]?.memo).toContain("checkout-456");
    expect(invoices[0]?.expiresAt).toBe("2030-01-01T00:00:00.000Z");
  });

  it("extracts a QR payload carried in markup", () => {
    const invoices = extractZecInvoices(
      `<canvas data-qr-payload="zcash:${address}?amount=0.005&amp;message=qr-order"></canvas>`
    );

    expect(invoices[0]?.source).toBe("qr-payload");
    expect(invoices[0]?.amountZec).toBe("0.005");
    expect(invoices[0]?.memo).toBe("qr-order");
  });

  it("marks conflicting invoice details as unstable", () => {
    const otherAddress = "u1invoiceother000000000000000000000000000000000000000";
    const invoices = extractZecInvoices(`
      zcash:${address}?amount=0.003&memo=a
      zcash:${otherAddress}?amount=0.004&memo=b
    `);

    expect(invoicesAreStable(invoices)).toBe(false);
  });
});
