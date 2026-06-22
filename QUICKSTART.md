# AgentZcash Quickstart

This is the fresh-computer path for making a shielded Zcash transfer through Codex or Claude Code with human approval.

AgentZcash does not let an agent approve or submit payment by itself. The agent prepares the transfer request, you approve it in the local dashboard, and AgentZcash submits through your managed local wallet.

## Prerequisites

- Node.js 20 or newer
- npm
- Git
- Rust/Cargo, if AgentZcash needs to build Zingo CLI from source
- Codex or Claude Code
- A shielded-capable Zcash recipient address that starts with `u1`, `utest`, `zs`, or `ztestsapling`

Transparent-only `t1` and `t3` recipient addresses are blocked for direct agent transfers.

Install the wallet dependency before initializing. AgentZcash installs `zingo-cli` into `~/.agentzcash/zingo-cli` when it is not already available:

```bash
npx agentzcash install-wallet
npx agentzcash wallet doctor
```

## 1. Download And Build

```bash
git clone <repo-url>
cd AgentZcash
npm install
npm run build
```

Check the built repo/runtime shape:

```bash
npx agentzcash doctor --runtime
```

If you are developing from this checkout, you can also run the no-funds software loop test:

```bash
npm run test:loop
```

## 2. Initialize The Managed Wallet

```bash
npx agentzcash init
```

During setup, AgentZcash:

- creates or resumes a dedicated wallet under `~/.agentzcash/wallet`
- shows the recovery seed once
- requires you to type `I saved this seed`
- writes `~/.agentzcash/agentzcash.config.yaml`
- prints the wallet receive address
- starts the dashboard and local MCP HTTP server when possible

If Zingo CLI is not found during init, run the managed installer and then run init again:

```bash
npx agentzcash install-wallet
npx agentzcash init
```

Use `npx agentzcash install-wallet --force` to rebuild or replace the managed binary.

Before funding, you can check the managed wallet state:

```bash
npx agentzcash wallet doctor
```


## 3. Fund The Agent Wallet

Print the managed wallet receive address:

```bash
npx agentzcash wallet receive
```

Send ZEC to that address from an external wallet or exchange. Then check that AgentZcash can see spendable balance:

```bash
npx agentzcash wallet balance
```

The wallet may need time to sync before balance is visible.

## 4. Check Readiness

Run:

```bash
npx agentzcash doctor --loop
```

You want the final summary to say:

```text
READY Shielded agentic transfer loop is ready.
```

If it says `NOT READY`, fix the failed checks shown by the command. Common fixes:

- run `npm install`
- run `npm run build`
- install or point to Zingo CLI
- fund the printed wallet address
- run `npx agentzcash mcp install codex --write`
- run `npx agentzcash mcp install claude --write`

## 5. Start The Local Services

From the repo root:

```bash
npx agentzcash start
```

This starts production-mode services when built output is available. For development hot reload, use:

```bash
npx agentzcash start --dev
```

Open the dashboard:

```text
http://localhost:3000
```

If you already ran `npx agentzcash init` and it started services, keep that terminal open.

## 6. Start Codex Or Claude Code

Start Codex or Claude Code from the repo root so it can see the project MCP config.

Included configs:

- Codex: `.codex/config.toml`
- Claude Code: `.mcp.json`

Both configs start MCP through:

```bash
npx agentzcash mcp stdio
```

Approve or trust the `agentzcash` MCP server when the agent client asks.

The MCP server exposes these relevant tools:

- `prepare_direct_transfer`
- `get_agentzcash_state`

It does not expose an approval tool.

## 7. Ask The Agent To Prepare A Shielded Transfer

Use a prompt like this:

```text
Use AgentZcash to prepare a shielded ZEC transfer.

Recipient name: Alice
Recipient address: u1...
Amount: 0.001 ZEC
Memo: Thanks
Purpose: Payment for invoice 123
Evidence URL: https://example.com/invoice-123

Do not approve or submit the payment yourself. Return the AgentZcash approval URL and tell me to review it in the dashboard. After I approve, call get_agentzcash_state and tell me whether the transfer is pending confirmation or receipted.
```

The agent should call `prepare_direct_transfer` and return an approval URL like:

```text
http://localhost:3000/?purchase=p_...
```

## 8. Approve In The Dashboard

Open the approval URL or go to:

```text
http://localhost:3000
```

Review:

- recipient name
- exact shielded-capable address
- amount
- memo
- purpose
- evidence
- policy checks

Click **Approve** only if everything is correct. Click **Reject** if anything is wrong.

## 9. Have The Agent Check Confirmation

After approval, ask Codex or Claude Code:

```text
Check AgentZcash state for the transfer and report the txid, status, confirmations, and receipt summary.
```

Expected states:

- `pending_confirmation`: wallet submitted the txid, but the configured confirmation count has not been reached
- `receipted`: the transaction reached the configured confirmation count and AgentZcash stored the receipt
- `payment_failed`: the wallet command failed
- `verification_failed`: vendor verification failed for a vendor purchase

For direct transfers, `get_agentzcash_state` refreshes pending confirmation status before returning state.

## Troubleshooting

`Zingo CLI binary not found`

Set `AGENTZCASH_ZINGO_CLI` to the absolute Zingo CLI binary path or install `zingo-cli` on `PATH`.

`Spendable balance: 0 ZEC`

Fund the address from `npx agentzcash wallet receive`, wait for wallet sync, then run `npx agentzcash wallet balance`.

`Recipient address must be shielded-capable`

Use a recipient address starting with `u1`, `utest`, `zs`, or `ztestsapling`.

`Codex or Claude does not see AgentZcash tools`

Run the installer for your client:

```bash
npx agentzcash mcp install codex --write
npx agentzcash mcp install claude --write
```

Then restart Codex or Claude Code from the repo root and approve the MCP server.

`Transaction stays pending`

Run:

```bash
npx agentzcash doctor --loop
```

Then ask the agent to call `get_agentzcash_state` again. Pending usually means the transaction is submitted but not confirmed enough yet, or the wallet cannot currently check transaction status.

## Safety Rules

- Agents may prepare transfer requests.
- Agents may not approve, reject, or submit payment through MCP.
- You must review the dashboard before money moves.
- Direct transfers require shielded-capable recipient addresses.
- Keep the wallet seed private and backed up.
