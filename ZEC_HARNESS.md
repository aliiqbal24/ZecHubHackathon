# ZEC Harness Protocol

ZEC Harness is the vendor-side contract AgentZcash agents use to buy products and services with ZEC. Vendors publish a manifest, quote an order, reserve it, verify payment, and return fulfillment with a signed receipt.

## Vendor Manifest

Expose:

```text
GET /.well-known/zec-harness.json
```

Required fields:

```json
{
  "name": "Example Vendor",
  "vendorUrl": "https://vendor.example",
  "version": "1.0.0",
  "description": "ZEC Harness compatible vendor.",
  "zecHarness": {
    "quoteUrl": "https://vendor.example/quote",
    "orderUrl": "https://vendor.example/orders",
    "verifyUrlTemplate": "https://vendor.example/orders/{orderId}/verify",
    "receiptPublicKey": "vendor-receipt-key",
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
  "itemId": "service-plan",
  "quantity": 1,
  "options": {
    "prompt": "Request the quoted service after showing exact ZEC terms."
  }
}
```

Response:

```json
{
  "quoteId": "q_...",
  "vendorUrl": "https://vendor.example",
  "vendorName": "Example Vendor",
  "itemId": "service-plan",
  "itemTitle": "Service Plan",
  "amountZec": "0.01",
  "expiresAt": "2026-06-09T12:00:00.000Z",
  "terms": ["Vendor fulfills only after payment verification."],
  "requiredPii": [],
  "fulfillmentType": "service",
  "privacy": {
    "label": "ZEC + vendor logs",
    "grade": "medium",
    "leaks": ["vendor sees order details"],
    "summary": "Payment uses ZEC."
  },
  "memo": "AGENTZCASH:q_...:service-plan",
  "payTo": "u1..."
}
```

Rules:

- `amountZec` is a decimal string with at most 8 fractional digits.
- `memo` must fit the 512-byte Zcash memo limit and include the `quoteId`.
- `expiresAt` must be enforced by both client and vendor.
- `requiredPii` must list every identity, shipping, or contact field needed before payment.

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
  "amountZec": "0.01",
  "payTo": "u1...",
  "memo": "AGENTZCASH:q_...:service-plan",
  "expiresAt": "2026-06-09T12:00:00.000Z"
}
```

## Payment Verification

Endpoint:

```text
POST /orders/:orderId/verify
```

The vendor fulfills only after it verifies the exact:

- `amountZec`
- `payTo`
- `memo`
- order correlation
- required confirmation count

If an order requires personal information, `verify` may receive approval-gated fields:

```json
{
  "releasedPii": {
    "name": "Customer Name",
    "line1": "Shipping line 1",
    "city": "City",
    "region": "Region",
    "postalCode": "Postal code",
    "country": "Country",
    "email": "customer@example.com"
  }
}
```

## Receipt

Once paid, the vendor returns:

```json
{
  "status": "fulfilled",
  "fulfillment": {
    "type": "service",
    "summary": "Payment verified. Fulfillment is handled by the vendor.",
    "payload": {}
  },
  "receipt": {
    "receiptId": "r_...",
    "orderId": "o_...",
    "quoteId": "q_...",
    "vendorUrl": "https://vendor.example",
    "amountZec": "0.01",
    "txId": "real-zec-transaction-id",
    "fulfilledAt": "2026-06-09T12:00:00.000Z",
    "summary": "Payment verified. Fulfillment is handled by the vendor.",
    "signature": "..."
  }
}
```

Vendors should sign receipts with a stable public key published in the manifest. AgentZcash requires `AGENTZCASH_RECEIPT_SECRET` for its local receipt signing and verification helpers.
