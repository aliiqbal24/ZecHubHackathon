# Agent Setup

AgentZcash exposes both an HTTP tool surface for local testing and an MCP stdio server for agents that support MCP.

For the complete fresh-computer flow, use [QUICKSTART.md](QUICKSTART.md).

## Run The Stack

```bash
npx agentzcash init
```

After the wallet is funded, run the readiness check:

```bash
npx agentzcash doctor --loop
```

It verifies wallet balance visibility, MCP config, build outputs, the MCP tool list, and an isolated no-funds direct-transfer prepare path.

To check built CLI/MCP/dashboard runtime files without touching wallet state:

```bash
npx agentzcash doctor --runtime
```

Services:

- Dashboard: `http://localhost:3000`
- MCP HTTP server: `http://localhost:3010`

`npx agentzcash start` uses production build output when available. Use `npx agentzcash start --dev` for development hot reload.

## MCP Stdio

Project-scoped configs are included:

- Claude Code: `.mcp.json`
- Codex: `.codex/config.toml`

Start the agent client from the repo root and approve/trust the project MCP server when prompted.

Install or refresh MCP config and agent safety instructions from any project folder:

```bash
npx agentzcash mcp install codex --write
npx agentzcash mcp install claude --write
```

The Codex installer writes `AGENTS.md`; the Claude Code installer writes `CLAUDE.md`. To refresh only those instruction files:

```bash
npx agentzcash instructions codex --write
npx agentzcash instructions claude --write
```

Manual stdio command:

```bash
npx agentzcash mcp stdio
```

Working directory:

```text
C:\ZecEZmoney
```

Tools:

- `discover_zec_vendor`
- `request_quote`
- `prepare_purchase`
- `prepare_direct_transfer`
- `claim_fulfillment`
- `get_agentzcash_state`

Approval is intentionally not exposed as a standalone MCP tool. The agent can request and prepare a purchase or direct transfer; AgentZcash either returns a dashboard approval URL or submits only when user-enabled autonomy and policy allow it.

## HTTP Tool Calls

List tools:

```bash
curl http://localhost:3010/mcp/tools
```

Request a quote from a real ZEC Harness vendor:

```bash
curl -X POST http://localhost:3010/mcp/call ^
  -H "content-type: application/json" ^
  -d "{\"name\":\"request_quote\",\"args\":{\"vendorUrl\":\"https://vendor.example\",\"itemId\":\"service-plan\",\"options\":{\"prompt\":\"Request the quoted service after showing exact ZEC terms.\"}}}"
```

Then open the dashboard and approve or reject the purchase if the tool returned an approval URL.

Prepare a direct transfer:

```bash
curl -X POST http://localhost:3010/mcp/call ^
  -H "content-type: application/json" ^
  -d "{\"name\":\"prepare_direct_transfer\",\"args\":{\"recipientName\":\"Alice\",\"amountZec\":\"0.01\",\"address\":\"u1...\",\"memo\":\"thanks\",\"purpose\":\"invoice payment\",\"evidenceUrls\":[\"https://example.com/invoice\"],\"agentVerificationNotes\":\"Address copied from invoice.\"}}"
```

## Agent Prompt

Use this instruction with an agent connected to AgentZcash:

```text
You can prepare direct ZEC transfers and request ZEC purchases through AgentZcash. Submit payments only through AgentZcash policy-gated tools. For direct transfers, use only shielded-capable recipient addresses that start with u1, utest, zs, or ztestsapling. Include recipient name, exact address, amount, memo, purpose, evidence URLs, and your verification notes. If AgentZcash returns an approval URL, tell the user to review the dashboard approval screen. Call get_agentzcash_state and report whether the transfer is awaiting approval, pending confirmation, receipted, or failed.
```

## Loop Smoke Test

Run the no-funds smoke test before trying a real wallet transfer:

```bash
npm run test:loop
```

It creates a temporary AgentZcash home, queues a direct transfer through the same MCP tool implementation, approves it through the dashboard API route with a fake wallet command, and checks that a direct-transfer receipt is stored.
