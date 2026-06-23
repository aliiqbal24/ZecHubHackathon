# AgentZcash

AgentZcash is a local approval and wallet-control layer for private, policy-governed AI agent ZEC payments. An agent can prepare a direct transfer or request a purchase from a vendor that exposes a ZEC Harness, while AgentZcash checks policy, shows the exact spend and conditions, requires dashboard approval by default, can submit clean under-limit payments only after the user enables autonomy, sends through the managed local Zingo wallet, and stores a receipt.

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

The installer downloads the managed Zingo CLI wallet dependency when needed, creates or resumes the managed AgentZcash wallet, shows the recovery seed once for backup, requires explicit seed-saved confirmation, writes `~/.agentzcash/agentzcash.config.yaml`, prints the receive address, and starts the dashboard/MCP server unless `--no-start` is passed.

Use `npx agentzcash init --dry-run` to preview setup without creating a wallet.

To install or replace only the managed wallet dependency:

```bash
npx agentzcash install-wallet
npx agentzcash wallet doctor
```

`install-wallet` downloads a prebuilt `zingo-cli` under `~/.agentzcash/zingo-cli` when no existing binary is found. Developer source builds are available with `npx agentzcash install-wallet --build-from-source`.

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

The loop doctor checks wallet readiness, project MCP config, build outputs, the MCP tool surface, and a no-funds direct-transfer prepare smoke test. Fresh installs remain dashboard-approval only.

Check whether the current checkout/install has the built runtime pieces needed for repo-mode startup:

```bash
npx agentzcash doctor --runtime
```

## Workspace Development

```bash
npm install
npm run build
npx agentzcash start
```

Then open:

```text
http://localhost:3000
```

The dashboard is an approval and wallet status console. Purchases are created through MCP tool calls from an agent or client.

For development hot reload instead of production startup:

```bash
npx agentzcash start --dev
```

The dashboard package ships the standalone Next app/server files, but intentionally does not ship `.next/standalone/node_modules`. Runtime dependencies such as Next, React, and platform-native optional packages are installed by npm on the user's computer, which keeps one package portable across Windows, macOS, and Linux.

## Release Artifacts

The release workflow builds managed Zingo CLI binaries with matching `.sha256` files, packs the four AgentZcash npm packages, and can publish them to npm when `NPM_TOKEN` is configured. See [RELEASE.md](RELEASE.md).

## Agent Connection

This repo includes project-scoped MCP config for both Claude Code (`.mcp.json`) and Codex (`.codex/config.toml`). After `npm install`, start Claude Code or Codex from the repo root and approve/trust the project MCP server when prompted.

Manual MCP stdio command:

```bash
npx agentzcash mcp stdio
```

Manual installers:

```bash
npx agentzcash mcp install claude --write
npx agentzcash mcp install codex --write
```

These write both the MCP config and the local agent safety instructions:

- Codex: `.codex/config.toml` and `AGENTS.md`
- Claude Code: `.mcp.json` and `CLAUDE.md`

If MCP is already configured, install only the instructions:

```bash
npx agentzcash instructions codex --write
npx agentzcash instructions claude --write
```

Available tools:

- `discover_zec_vendor`
- `request_quote`
- `prepare_purchase`
- `prepare_direct_transfer`
- `claim_fulfillment`
- `get_agentzcash_state`

The dashboard approval endpoint is intentionally not exposed as an MCP tool. Agents can prepare payment intents; AgentZcash submits only through local policy, with dashboard approval required by default and for any warning or limit breach.

## Shielded Agentic Transfer Loop

1. User runs `npx agentzcash init`, backs up the seed, and funds the printed wallet address.
2. User starts Codex or Claude Code from the repo root with AgentZcash MCP enabled.
3. Agent calls `prepare_direct_transfer` with a shielded-capable recipient address (`u1`, `utest`, `zs`, or `ztestsapling`), amount, memo, purpose, and verification evidence.
4. Agent returns the dashboard approval URL when approval is required, or a submitted/pending/receipted status when autonomy is enabled and all checks pass.
5. User reviews the dashboard and approves or rejects any approval-required payment.
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
