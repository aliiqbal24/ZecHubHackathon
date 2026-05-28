# ZecGuard

ZecGuard is a local prototype for private, policy-governed AI agent purchases over Zcash. An agent can request a purchase from any vendor that exposes a ZEC Harness, but ZecGuard checks policy, shows the exact spend and conditions, requires human approval, sends payment through a wallet adapter, and stores a signed private receipt.

## What Is Implemented

- Local web dashboard at `http://localhost:3000`
- MCP-capable agent server with HTTP tools on `http://localhost:3010`
- Reference ZEC Harness vendor on `http://localhost:3020`
- Shared TypeScript protocol, policy engine, state machine, mock wallet, and receipt signing
- Natural-language purchase request flow
- Digital-service and physical-goods demo purchases
- Approval-gated PII release for physical orders
- YAML spending policy with per-transaction, daily, and monthly limits
- Mock wallet path for smooth demos and an external CLI wallet adapter boundary for real Zcash tooling
- Mock payment ledger so the vendor verifies a recorded payment instead of trusting a callback payload

## Run It

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

For MCP stdio clients, use:

```bash
npm run mcp:stdio
```

Available tools:

- `discover_zec_vendor`
- `request_quote`
- `prepare_purchase`
- `claim_fulfillment`
- `get_zecguard_state`

The dashboard approval endpoint is intentionally not exposed as an autonomous MCP tool. Agents can prepare payment intents; humans approve payments.

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

The mock wallet is the default because it keeps the prototype reliable without local Zcash node setup. The real-payment seam is `ExternalCliWalletAdapter` in `packages/core/src/wallet.ts`; configure `agent.walletMode: external-cli` and `agent.externalCliCommand` in `zecguard.config.yaml` to route sends through a local wallet command.

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
