# Real Wallet Integration

AgentZcash uses one managed Zingo CLI wallet by default. Approval cannot submit payment unless the managed wallet exists, is backed up, and has spendable ZEC.

## Initialize

```bash
npx agentzcash install-wallet
npx agentzcash init
```

AgentZcash stores wallet data under `~/.agentzcash/wallet` by passing Zingo CLI a dedicated `--data-dir`; it does not use the user's default Zingo wallet directory. The seed phrase is displayed for backup during initialization and is not stored as plaintext by AgentZcash.

If Zingo CLI is not already available on `PATH` or `AGENTZCASH_ZINGO_CLI`, AgentZcash installs it under `~/.agentzcash/zingo-cli` with a single Cargo build job to reduce peak memory use. To rebuild or replace that managed binary, run:

```bash
npx agentzcash install-wallet --force
```

To check whether the local Zingo CLI dependency, managed wallet directory, config, and spendable balance are ready, run:

```bash
npx agentzcash wallet doctor
```

## Generated Config

`~/.agentzcash/agentzcash.config.yaml` uses the managed Zingo preset:

```yaml
agent:
  name: AgentZcash
  walletMode: external-cli
  walletAddress: u1...
  walletPreset: zingo-cli

verification:
  mode: external-cli
  minConfirmations: 1
```

Placeholders:

- `{to}`: vendor payment address
- `{amount}`: decimal ZEC amount
- `{memo}`: ZEC Harness memo
- `{memoHex}`: UTF-8 memo encoded as hex, for wallet commands that require it
- `{walletDir}`: AgentZcash managed wallet directory

If you override the preset and no send placeholders are present, AgentZcash appends:

```text
--to <address> --amount <zec> --memo <memo>
```

The send command must print a transaction id as the last whitespace-separated token on stdout.

## Vendor Payment Detection

`verification.externalCliCommand` must return received transactions that include the ZEC Harness memo, amount, transaction id, and confirmations. A production vendor can also use a `lightwalletd` watcher when `verification.mode: lightwalletd` is configured.

The invariant is: fulfill only after the vendor has verified the exact quote amount, payment address, memo, and order correlation.

## Local Prerequisites

Fund the receive address printed by `agentzcash init` or `agentzcash wallet receive`.

Check spendable balance:

```bash
agentzcash wallet balance
```

If balance refresh fails, AgentZcash displays `0 ZEC` until a live wallet balance is available.

Direct agent transfers require a shielded-capable recipient address (`u1`, `utest`, `zs`, or `ztestsapling`). Transparent-only `t1` and `t3` direct-transfer recipients are blocked by policy.
