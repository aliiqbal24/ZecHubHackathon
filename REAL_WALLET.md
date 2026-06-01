# Real Wallet Integration

The prototype defaults to a mock wallet so the full user flow works without local Zcash infrastructure. Real agent spending is isolated behind a dedicated Zingo CLI wallet in `packages/core/src/wallet.ts`.

Each agent wallet lives under `.zecguard/wallets/<walletId>`. Agents never receive keys or direct wallet filesystem access; they request payments through MCP, and ZecGuard sends only after policy checks and user approval.

## Configure Zingo CLI Mode

Install `zingo-cli`, then edit `zecguard.config.yaml`:

```yaml
agent:
  name: Research Buyer
  walletMode: mock
  walletAddress: u1...

agentWallet:
  backend: zingo-cli
  label: Research Buyer Wallet
  walletId: agent-default
  zingoCliPath: zingo-cli
  zingoServerUrl:
  mainReturnAddress: u1...
```

When the dashboard refreshes, ZecGuard runs commands like:

```text
zingo-cli --data-dir .zecguard/wallets/agent-default [--server <url>] [--waitsync] <command>
```

The dashboard shows the deposit address, total balance, spendable balance, and setup errors. Funding is manual in v1: send a small amount of ZEC to the displayed agent wallet address, then approve purchases normally.

## Returning Funds

Set `agentWallet.mainReturnAddress` to enable the dashboard-only sweep action. Sweep is intentionally not exposed as an MCP tool. ZecGuard reserves a small fee and sends the remaining spendable balance back to the configured return address.

## Legacy External CLI Mode

The older `agent.walletMode: external-cli` adapter remains for compatibility, but new real-wallet work should use `agentWallet.backend: zingo-cli`.

## Vendor Payment Detection

The demo vendor verifies payments by scanning the local mock payment ledger. A real vendor should replace that with one of:

- Wallet/viewing-key monitoring for incoming shielded payments.
- A lightwalletd-backed watcher.
- A payment processor that can confirm the exact address, amount, and memo.

The production invariant is the same as the mock invariant: fulfill only after the vendor has verified the exact quote amount, payment address, memo, and order correlation.

## Current Blockers On This Machine

These tools are not installed in the current environment:

- `zcashd`
- `zcash-cli`
- `zebrad`
- `zingo-cli`
- `zallet`

Because of that, the prototype cannot submit a real mainnet shielded transaction here yet. The mock backend remains available for demos and CI.
