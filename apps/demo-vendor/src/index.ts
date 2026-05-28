import express from "express";
import cors from "cors";
import { randomUUID } from "node:crypto";
import {
  appendActivity,
  createPaymentVerifier,
  findMatchingLedgerPayment,
  loadConfig,
  loadState,
  quoteRequestSchema,
  signReceipt,
  upsertVendorOrder,
  updateState,
  zecToZats,
  type Fulfillment,
  type HarnessManifest,
  type QuoteResponse,
  type VendorOrder,
  type VendorProduct
} from "@zecguard/core";

const PORT = Number(process.env.DEMO_VENDOR_PORT ?? 3020);
const VENDOR_URL = process.env.DEMO_VENDOR_URL ?? `http://localhost:${PORT}`;
const PAY_TO =
  process.env.DEMO_VENDOR_ZEC_ADDRESS ??
  "u1zecguarddemovendor000000000000000000000000000000000000000000000000000";

const quotes = new Map<string, QuoteResponse>();

const products: VendorProduct[] = [
  {
    id: "ai-brief",
    title: "Private AI briefing",
    description: "A paid AI-generated briefing returned only after ZEC payment verification.",
    fulfillmentType: "digital",
    basePriceZec: "0.003",
    requiresPii: []
  },
  {
    id: "privacy-kit",
    title: "Privacy hardware starter kit",
    description: "A simulated physical order that demonstrates approval-gated shipping details.",
    fulfillmentType: "physical",
    basePriceZec: "0.025",
    requiresPii: ["name", "line1", "city", "region", "postalCode", "country", "email"]
  }
];

function manifest(): HarnessManifest {
  return {
    name: "Orchard Market Demo",
    vendorUrl: VENDOR_URL,
    version: "0.1.0",
    description: "Reference ZEC Harness vendor for agent-mediated purchases.",
    zecHarness: {
      quoteUrl: `${VENDOR_URL}/quote`,
      orderUrl: `${VENDOR_URL}/orders`,
      verifyUrlTemplate: `${VENDOR_URL}/orders/{orderId}/verify`,
      receiptPublicKey: "hmac-demo-key",
      supportedFulfillment: ["digital", "physical", "service"]
    },
    privacy: {
      label: "ZEC + vendor logs",
      grade: "medium",
      leaks: ["vendor sees order details", "IP/session visible to vendor"],
      summary: "Payment uses ZEC; fulfillment details are shared only when required."
    },
    products
  };
}

function productFor(itemId: string): VendorProduct {
  const product = products.find((item) => item.id === itemId);
  if (!product) {
    throw new Error(`Unknown product: ${itemId}`);
  }
  return product;
}

async function generateAiBrief(prompt: string): Promise<string> {
  const endpoint = process.env.LLM_API_URL;
  const apiKey = process.env.LLM_API_KEY;
  const model = process.env.LLM_MODEL ?? "gpt-4.1-mini";

  if (endpoint && apiKey) {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json"
      },
      body: JSON.stringify({
        model,
        messages: [
          {
            role: "system",
            content:
              "You are a terse vendor API. Return a useful private research briefing in under 120 words."
          },
          { role: "user", content: prompt }
        ]
      })
    });

    if (response.ok) {
      const json = (await response.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
      };
      const content = json.choices?.[0]?.message?.content;
      if (content) return content;
    }
  }

  return `Briefing: ZEC-native agent commerce is strongest when vendors expose quotes, payment instructions, fulfillment terms, and private receipts. For "${prompt}", prioritize a tiny mainnet payment, clear approval screen, and proof that the vendor verified payment before delivering output.`;
}

async function fulfillOrder(order: VendorOrder): Promise<Fulfillment> {
  if (order.quote.itemId === "privacy-kit") {
    return {
      type: "physical",
      summary: "Privacy hardware starter kit reserved for shipment.",
      payload: {
        tracking: `ZEC-${randomUUID().slice(0, 8).toUpperCase()}`,
        carrier: "DemoCourier",
        shipTo: order.releasedPii ?? {}
      }
    };
  }

  const prompt =
    typeof order.quote.memo === "string"
      ? `Agent order ${order.orderId}: ${order.quote.itemTitle}`
      : "ZecGuard agent commerce";
  return {
    type: "digital",
    summary: "Private AI briefing delivered.",
    payload: {
      result: await generateAiBrief(prompt),
      format: "text/markdown"
    }
  };
}

function createQuote(itemId: string, options: Record<string, unknown> | undefined): QuoteResponse {
  const product = productFor(itemId);
  const quoteId = `q_${randomUUID()}`;
  const amountZats = zecToZats(product.basePriceZec);
  const memo = `ZECGUARD:${quoteId}:${product.id}`;
  const quote: QuoteResponse = {
    quoteId,
    vendorUrl: VENDOR_URL,
    vendorName: manifest().name,
    itemId: product.id,
    itemTitle: product.title,
    amountZec: product.basePriceZec,
    expiresAt: new Date(Date.now() + 10 * 60_000).toISOString(),
    terms: [
      "Vendor fulfills only after payment verification.",
      "Quote expires after 10 minutes.",
      product.fulfillmentType === "physical"
        ? "Shipping details are used only for this order."
        : "Digital result is delivered through the order status endpoint."
    ],
    requiredPii: product.requiresPii,
    fulfillmentType: product.fulfillmentType,
    privacy: manifest().privacy,
    memo,
    payTo: PAY_TO
  };

  if (amountZats <= 0) {
    throw new Error("Invalid demo price");
  }
  if (options?.prompt && typeof options.prompt === "string") {
    quote.terms = [`Prompt: ${options.prompt}`, ...quote.terms];
  }
  quotes.set(quoteId, quote);
  return quote;
}

const app = express();
app.use(cors());
app.use(express.json({ limit: "1mb" }));

app.get("/health", (_request, response) => {
  response.json({ ok: true, vendor: manifest().name });
});

app.get("/.well-known/zec-harness.json", (_request, response) => {
  response.json(manifest());
});

app.get("/catalog", (_request, response) => {
  response.json({ products });
});

app.post("/quote", (request, response) => {
  try {
    const body = quoteRequestSchema.parse(request.body);
    response.json(createQuote(body.itemId, body.options));
  } catch (error) {
    response.status(400).json({ error: error instanceof Error ? error.message : "Invalid quote request" });
  }
});

app.post("/orders", (request, response) => {
  const quoteId = String(request.body?.quoteId ?? "");
  const quote = quotes.get(quoteId);
  if (!quote) {
    response.status(404).json({ error: "Quote not found or expired" });
    return;
  }

  const order: VendorOrder = {
    orderId: `o_${randomUUID()}`,
    quote,
    status: "awaiting_payment",
    createdAt: new Date().toISOString(),
    releasedPii: request.body?.releasedPii
  };

  updateState((state) => {
    upsertVendorOrder(state, order);
    appendActivity(state, {
      kind: "vendor",
      title: "Vendor reserved order",
      detail: `${quote.itemTitle} reserved at ${manifest().name}.`
    });
  });

  response.json({
    orderId: order.orderId,
    quoteId: quote.quoteId,
    status: order.status,
    amountZec: quote.amountZec,
    payTo: quote.payTo,
    memo: quote.memo,
    expiresAt: quote.expiresAt
  });
});

app.post("/orders/:orderId/verify", async (request, response) => {
  const releasedPii = request.body?.releasedPii as Record<string, unknown> | undefined;
  const state = loadState();
  const config = loadConfig();
  const order = state.vendorOrders.find((item) => item.orderId === request.params.orderId);
  if (!order) {
    response.status(404).json({ error: "Order not found" });
    return;
  }

  const verifier = createPaymentVerifier(config);
  const verified = await verifier.verifyPayment(order);

  if (!verified) {
    const ledgerEntry = findMatchingLedgerPayment(state, order);
    if (ledgerEntry) {
      response.status(202).json({
        status: "pending_confirmation",
        message: "Payment found but awaiting on-chain confirmation.",
        txId: ledgerEntry.txId
      });
      return;
    }
    response.status(402).json({ error: "No matching ZEC payment found for this order" });
    return;
  }

  order.releasedPii = releasedPii ?? order.releasedPii;
  const fulfillment = await fulfillOrder(order);
  const fulfilledAt = new Date().toISOString();
  const receipt = signReceipt({
    receiptId: `r_${randomUUID()}`,
    orderId: order.orderId,
    quoteId: order.quote.quoteId,
    vendorUrl: order.quote.vendorUrl,
    amountZec: order.quote.amountZec,
    txId: verified.txId,
    fulfilledAt,
    summary: fulfillment.summary
  });

  updateState((draft) => {
    const existing = draft.vendorOrders.find((item) => item.orderId === order.orderId);
    if (!existing) return;
    existing.status = "fulfilled";
    existing.payment = { txId: verified.txId, amountZec: verified.amountZec, amountZats: zecToZats(verified.amountZec), payTo: order.quote.payTo, memo: verified.memo, submittedAt: verified.matchedAt, walletMode: config.agent.walletMode };
    existing.releasedPii = releasedPii ?? existing.releasedPii;
    existing.paidAt = verified.matchedAt;
    existing.fulfilledAt = fulfilledAt;
    existing.fulfillment = fulfillment;
    existing.receipt = receipt;
    appendActivity(draft, {
      kind: "fulfillment",
      title: "Vendor fulfilled order",
      detail: fulfillment.summary
    });
  });

  response.json({ status: "fulfilled", fulfillment, receipt });
});

app.get("/orders/:orderId", (request, response) => {
  const order = loadState().vendorOrders.find((item) => item.orderId === request.params.orderId);
  if (!order) {
    response.status(404).json({ error: "Order not found" });
    return;
  }
  response.json(order);
});

app.listen(PORT, () => {
  console.log(`ZecGuard demo vendor listening on ${VENDOR_URL}`);
});
