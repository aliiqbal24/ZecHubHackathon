# AgentZcash

AgentZcash is a local approval and wallet-control layer for private, policy-governed AI agent ZEC payments. An agent can queue a direct transfer or request a purchase from a vendor that exposes a ZEC Harness, while AgentZcash checks policy, shows the exact spend and conditions, requires human approval, sends payment through the managed local Zingo wallet, and stores a receipt.

## What Is Implemented

- Local web dashboard at `http://localhost:3000`
- MCP-capable agent server with HTTP tools on `http://localhost:3010`
- Shared TypeScript protocol, policy engine, state machine, external wallet adapter, and receipt verification
- YAML spending policy with per-transaction, daily, and monthly limits
- `agentzcash` CLI package for `npx agentzcash init`
- One managed Zingo CLI wallet under `~/.agentzcash/wallet`
- Direct ZEC transfer approvals through `prepare_direct_transfer`
- Vendor-side payment verification through `external-cli` or `lightwalletd`

## Download-And-Run Setup

For the full fresh-computer path, see [QUICKSTART.md](QUICKSTART.md).

```bash
git clone <repo-url>
cd AgentZcash
npm install
npm run build
npx agentzcash init
```

The installer creates or resumes the managed AgentZcash wallet, shows the recovery seed once for backup, requires explicit seed-saved confirmation, writes `~/.agentzcash/agentzcash.config.yaml`, prints the receive address, and starts the dashboard/MCP server unless `--no-start` is passed.

Use `npx agentzcash init --dry-run` to preview setup without creating a wallet.

If Zingo CLI is missing, run:

```bash
npx agentzcash install-wallet
npx agentzcash wallet doctor
```

## Fund The Agent Wallet

```bash
npx agentzcash wallet receive
```

Send ZEC to the printed address from an external wallet or exchange, then verify the managed wallet can see the funds:

```bash
npx agentzcash wallet balance
```

AgentZcash will not approve a spend unless the local wallet reports enough live balance.

Check whether this computer is ready for the full agent loop:

```bash
npx agentzcash doctor --loop
```

The loop doctor checks wallet readiness, project MCP config, build outputs, the MCP tool surface, and a no-funds direct-transfer prepare smoke test. It does not approve or submit a payment.

## Workspace Development

```bash
npm install
npm run dev
```

Then open:

```text
http://localhost:3000
```

The dashboard is an approval and wallet status console. Purchases are created through MCP tool calls from an agent or client.

## Agent Connection

This repo includes project-scoped MCP config for both Claude Code (`.mcp.json`) and Codex (`.codex/config.toml`). After `npm install`, start Claude Code or Codex from the repo root and approve/trust the project MCP server when prompted.

Manual MCP stdio command:

```bash
npm --silent run mcp:stdio
```

Manual installers:

```bash
npx agentzcash mcp install claude --write
npx agentzcash mcp install codex --write
```

Available tools:

- `discover_zec_vendor`
- `request_quote`
- `prepare_purchase`
- `prepare_direct_transfer`
- `claim_fulfillment`
- `get_agentzcash_state`

The dashboard approval endpoint is intentionally not exposed as an autonomous MCP tool. Agents can prepare payment intents; humans approve payments.

## Shielded Agentic Transfer Loop

1. User runs `npx agentzcash init`, backs up the seed, and funds the printed wallet address.
2. User starts Codex or Claude Code from the repo root with AgentZcash MCP enabled.
3. Agent calls `prepare_direct_transfer` with a shielded-capable recipient address (`u1`, `utest`, `zs`, or `ztestsapling`), amount, memo, purpose, and verification evidence.
4. Agent returns the dashboard approval URL.
5. User reviews the dashboard and approves or rejects the payment.
6. Agent calls `get_agentzcash_state` to check whether the submitted transaction is still `pending_confirmation` or has reached the configured confirmation count and become `receipted`.

To verify this loop without real funds or a live wallet, run:

```bash
npm run test:loop
```

That smoke test uses an isolated temp AgentZcash home and a fake external wallet command. It proves the MCP direct-transfer tool can create an approval request and the dashboard approval route stores a local direct-transfer receipt.

## Verify

```bash
npm test
npm run test:loop
npm run typecheck
npm run build
```
