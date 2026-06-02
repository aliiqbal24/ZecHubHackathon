# ZecGuard

ZecGuard is a local prototype for private, policy-governed AI agent purchases over Zcash. An agent can request a purchase from a vendor that exposes a ZEC Harness, start a generic web checkout that accepts ZEC, resolve a local P2P contact, or prepare a generic ZIP-321/raw ZEC payment like a wallet send. ZecGuard checks policy, shows the exact spend and conditions, requires human approval, sends payment through a wallet adapter, and stores either a signed vendor receipt or a local payment receipt.

## What Is Implemented

- Local web dashboard at `http://localhost:3000`
- MCP-capable agent server with HTTP tools on `http://localhost:3010`
- Reference ZEC Harness vendor on `http://localhost:3020`
- Generic ZEC payment preparation from ZIP-321 URIs or raw address/amount/memo inputs
- Vendor-agnostic `start_web_purchase` MCP flow for generic web checkout invoice extraction
- Local P2P contact resolution from `.zecguard/contacts.md`
- Shared TypeScript protocol, policy engine, state machine, mock wallet, and receipt signing
- Natural-language purchase request flow
- Digital-service and physical-goods demo purchases
- Approval-gated PII release for physical orders
- YAML spending policy with per-transaction, daily, and monthly limits
- Mock wallet path for smooth demos and an external CLI wallet adapter boundary for real Zcash tooling
- Mock payment ledger so the vendor verifies a recorded payment instead of trusting a callback payload

## Normal User Install

Add ZecGuard to an MCP client with one stdio command:

```bash
npx -y @zechub/zecguard mcp
```

That command creates user-level ZecGuard config/state, starts the local dashboard on `127.0.0.1`, then starts MCP stdio. Dashboard logs are written to stderr so MCP protocol output on stdout stays clean.

Test a fresh install before adding it to an agent:

```bash
npx -y @zechub/zecguard doctor
```

First run uses a real-wallet setup wizard. Purchase preparation returns `setup_required` until Zingo CLI is configured, the wallet preflight passes, backup and return-address checks are confirmed, and a small test deposit/sweep is complete.

## Developer Run From Source

```bash
npm install
npm run dev
```

Then open:

```text
http://localhost:3000
```

Reset local demo state:

```bash
npm run demo:reset
```

Verify the browser flow:

```bash
npm run demo:verify
```

## Demo Flow

1. Enter a natural-language request in the dashboard.
2. Click **Request quote**.
3. The MCP server asks the demo vendor for a ZEC quote and reserves an order.
4. ZecGuard checks the local YAML policy.
5. Approve or reject the pending payment.
6. On approval, the mock wallet submits a ZEC payment record into the local payment ledger.
7. The vendor scans for a matching amount, address, memo, vendor, and order before returning fulfillment.
8. ZecGuard stores the signed private receipt.

## Agent Connection

For normal MCP stdio clients, use:

```bash
npx -y @zechub/zecguard mcp
```

Developer source checkout only:

```bash
npm run mcp:stdio
```

Available tools:

- `discover_zec_vendor`
- `request_quote`
- `start_web_purchase`
- `prepare_zec_payment`
- `review_purchase`
- `approve_and_pay_purchase`
- `claim_fulfillment`
- `get_zecguard_state`

`approve_and_pay_purchase` is marked destructive, non-idempotent, and open-world in MCP metadata. Agents should call it only after explicit user approval; MCP clients should keep their permission prompt enabled for that tool. Dashboard approval remains available as the safer fallback.

`start_web_purchase` is non-destructive. It can start a browser-checkout-style session from a natural-language request, optional target URL/vendor hint, and optional checkout HTML fixture. It extracts ZIP-321 URIs, visible Zcash address + amount pairs, or QR payload text, creates a normal approval request, and returns `needs_user_input` when checkout requires email, country, login, captcha, or another missing user action. It never sends funds.

## Payment Tiers

Tier 1 ZEC Harness vendors support quote, order reservation, policy review, payment submission, vendor verification, fulfillment, and signed private receipts.

Tier 2 generic ZEC payments support "pay this ZEC address/payment URI" flows. ZecGuard can parse a ZIP-321 URI or raw address/amount/memo, run spending and memo policy checks, submit payment after approval, and store a local receipt. Automatic fulfillment is not available unless the recipient exposes a compatible verification API.

Tier 3 web checkout sessions support generic ZEC invoice extraction from checkout pages. Vendor profiles such as Coinsbee are only hints for selectors, trust labels, and fulfillment cues; payment execution still goes through the same review and approval path.

P2P requests such as `send Ali 0.003 ZEC` resolve aliases from `.zecguard/contacts.md`. Missing or ambiguous contacts pause with `needs_user_input`.

## Web Purchase Demos

Run the MCP server first:

```bash
npm run dev:mcp
```

Then in another terminal:

```bash
npm run demo:agent-p2p
npm run demo:web-purchase
npm run demo:coinsbee
```

The Coinsbee command is a dry-run fixture by default. Set `COINSBEE_CHECKOUT_HTML` or `COINSBEE_CHECKOUT_URL` to test a captured/live checkout page up to invoice extraction. Payment still requires explicit approval through `approve_and_pay_purchase` or the dashboard.

## ZEC Harness Vendor Contract

A compatible vendor exposes:

- `/.well-known/zec-harness.json`
- `POST /quote`
- `POST /orders`
- `GET /orders/:id`
- `POST /orders/:id/verify`

The demo vendor verifies against the local mock payment ledger. In a production Zcash integration, the vendor would verify shielded payment through wallet/lightwallet infrastructure rather than accepting the mock ledger.

Protocol details are in `ZEC_HARNESS.md`.

## Real Wallet Boundary

The packaged CLI defaults to the real Zingo CLI setup wizard and stores runtime files in user app-data. The source checkout can still use mock/demo settings through `zecguard.config.yaml` for local development.

Real wallet details are in `REAL_WALLET.md`.

## Docs

- `ZEC_HARNESS.md`: vendor protocol
- `AGENT_SETUP.md`: MCP and agent setup
- `REAL_WALLET.md`: external wallet adapter
- `HACKATHON_SUBMISSION.md`: demo narrative and judging notes

## Verify

```bash
npm test
npm run typecheck
npm run build
npm run demo:verify
```
