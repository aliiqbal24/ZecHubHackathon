# Real Wallet Integration

The current prototype defaults to a mock wallet so the full user flow works without local Zcash infrastructure. Real sending is isolated behind the external CLI adapter in `packages/core/src/wallet.ts`.

## Configure External CLI Mode

Edit `zecguard.config.yaml`:

```yaml
agent:
  name: Research Buyer
  walletMode: external-cli
  walletAddress: u1...
  externalCliCommand: "zingo-cli send --recipient {to} --value {amount} --memo {memo}"
```

Placeholders:

- `{to}`: vendor payment address
- `{amount}`: decimal ZEC amount
- `{memo}`: ZEC Harness memo

If no placeholders are present, ZecGuard appends:

```text
--to <address> --amount <zec> --memo <memo>
```

The CLI command must print a transaction id as the last whitespace-separated token on stdout.

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

Because of that, the prototype cannot submit a real mainnet shielded transaction here yet. The app is ready for that integration once one wallet backend is installed and funded.
