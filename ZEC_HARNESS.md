# ZEC Harness Protocol

ZEC Harness is the vendor-side contract ZecGuard agents use to buy products and services with ZEC. It is intentionally small: vendors publish a manifest, quote an order, reserve it, verify payment, and return fulfillment with a signed receipt.

## Vendor Manifest

Expose:

```text
GET /.well-known/zec-harness.json
```

Required fields:

```json
{
  "name": "Orchard Market Demo",
  "vendorUrl": "http://localhost:3020",
  "version": "0.1.0",
  "description": "Reference ZEC Harness vendor.",
  "zecHarness": {
    "quoteUrl": "http://localhost:3020/quote",
    "orderUrl": "http://localhost:3020/orders",
    "verifyUrlTemplate": "http://localhost:3020/orders/{orderId}/verify",
    "receiptPublicKey": "hmac-demo-key",
    "supportedFulfillment": ["digital", "physical", "service"]
  },
  "privacy": {
    "label": "ZEC + vendor logs",
    "grade": "medium",
    "leaks": ["vendor sees order details", "IP/session visible to vendor"],
    "summary": "Payment uses ZEC; fulfillment details are shared only when required."
  },
  "products": []
}
```

## Quote

```text
POST /quote
```

Request:

```json
{
  "itemId": "ai-brief",
  "quantity": 1,
  "options": {
    "prompt": "Research ZEC-native agent payments"
  }
}
```

Response:

```json
{
  "quoteId": "q_...",
  "vendorUrl": "http://localhost:3020",
  "vendorName": "Orchard Market Demo",
  "itemId": "ai-brief",
  "itemTitle": "Private AI briefing",
  "amountZec": "0.003",
  "expiresAt": "2026-05-28T12:00:00.000Z",
  "terms": ["Vendor fulfills only after payment verification."],
  "requiredPii": [],
  "fulfillmentType": "digital",
  "privacy": {
    "label": "ZEC + vendor logs",
    "grade": "medium",
    "leaks": ["vendor sees order details"],
    "summary": "Payment uses ZEC."
  },
  "memo": "ZECGUARD:q_...:ai-brief",
  "payTo": "u1..."
}
```

Rules:

- `amountZec` is a decimal string with at most 8 fractional digits.
- `memo` must fit the 512-byte Zcash memo limit and include the `quoteId`.
- `expiresAt` must be enforced by both client and vendor.
- `requiredPii` must list every identity/shipping/contact field needed before payment.

## Order Reservation

```text
POST /orders
```

Request:

```json
{
  "quoteId": "q_..."
}
```

Response:

```json
{
  "orderId": "o_...",
  "quoteId": "q_...",
  "status": "awaiting_payment",
  "amountZec": "0.003",
  "payTo": "u1...",
  "memo": "ZECGUARD:q_...:ai-brief",
  "expiresAt": "2026-05-28T12:00:00.000Z"
}
```

## Payment Verification

Prototype:

```text
POST /orders/:orderId/verify
```

The demo vendor scans the local mock payment ledger for a payment matching:

- `orderId`
- `vendorUrl`
- `amountZec`
- `payTo`
- `memo`

Production vendors should replace this with Zcash wallet or viewing-key monitoring. The important contract is that fulfillment must not happen until the vendor verifies the exact payment instructions.

For physical orders, `verify` may receive approval-gated PII:

```json
{
  "releasedPii": {
    "name": "Ada Demo",
    "line1": "123 Orchard Lane",
    "city": "Denver",
    "region": "CO",
    "postalCode": "80202",
    "country": "US",
    "email": "ada@example.test"
  }
}
```

## Receipt

Once paid, vendor returns:

```json
{
  "status": "fulfilled",
  "fulfillment": {
    "type": "digital",
    "summary": "Private AI briefing delivered.",
    "payload": {}
  },
  "receipt": {
    "receiptId": "r_...",
    "orderId": "o_...",
    "quoteId": "q_...",
    "vendorUrl": "http://localhost:3020",
    "amountZec": "0.003",
    "txId": "mock-zec-...",
    "fulfilledAt": "2026-05-28T12:00:00.000Z",
    "summary": "Private AI briefing delivered.",
    "signature": "..."
  }
}
```

The prototype uses HMAC receipts. A production vendor should sign receipts with a stable public key published in the manifest.
