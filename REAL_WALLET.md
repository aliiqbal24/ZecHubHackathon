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
  maxRealWalletBalanceZec: "0.05"
```

When the dashboard refreshes, ZecGuard runs commands like:

```text
zingo-cli --data-dir .zecguard/wallets/agent-default [--server <url>] [--waitsync] <command>
```

The dashboard shows the wallet status, balance, safety checklist, address fingerprints, and setup errors. Real funding is blocked by default. Treat the deposit address as "not ready to fund" until the dashboard checklist says **Ready for real funding**.

The strict launch checklist requires:

- Wallet backup or recovery material created.
- Backup stored offline.
- `mainReturnAddress` configured and verified by re-typing its final characters.
- Zingo CLI preflight passed: CLI available, wallet data directory exists, deposit address parsed, and balance refresh works.
- Small test deposit observed.
- Small test sweep completed.

Until all checks pass, real-wallet approvals fail closed. ZecGuard also blocks approvals when the spendable wallet balance exceeds `agentWallet.maxRealWalletBalanceZec`; sweep excess funds before approving purchases.

## Returning Funds

Set `agentWallet.mainReturnAddress` to enable the dashboard-only sweep action. Sweep is intentionally not exposed as an MCP tool. ZecGuard reserves a small fee and sends the remaining spendable balance back to the configured return address.

If the wallet becomes unhealthy, recover with your offline backup and the wallet data path shown in the dashboard: `.zecguard/wallets/<walletId>`. Deleting that directory without a backup can lose access to any funds controlled by the agent wallet.

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
