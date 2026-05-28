# Agent Setup

ZecGuard exposes both an HTTP tool surface for local testing and an MCP stdio server for agents that support MCP.

## Run The Stack

```bash
npm run dev
```

Services:

- Dashboard: `http://localhost:3000`
- MCP HTTP server: `http://localhost:3010`
- Demo vendor: `http://localhost:3020`

## MCP Stdio

Use this command in an MCP-capable client:

```bash
npm run mcp:stdio
```

Working directory:

```text
C:\ZecEZmoney
```

Tools:

- `discover_zec_vendor`
- `request_quote`
- `prepare_purchase`
- `claim_fulfillment`
- `get_zecguard_state`

Approval is intentionally not exposed as an autonomous MCP tool. The agent can request and prepare a purchase; the dashboard user approves payment.

## HTTP Tool Calls

List tools:

```bash
curl http://localhost:3010/mcp/tools
```

Request a quote:

```bash
curl -X POST http://localhost:3010/mcp/call ^
  -H "content-type: application/json" ^
  -d "{\"name\":\"request_quote\",\"args\":{\"vendorUrl\":\"http://localhost:3020\",\"itemId\":\"ai-brief\",\"options\":{\"prompt\":\"Explain private agent commerce.\"}}}"
```

Then open the dashboard and approve the purchase.

## Agent Prompt

Use this instruction with an agent connected to ZecGuard:

```text
You can request ZEC purchases through ZecGuard, but you may not approve payment. Before requesting a quote, identify the vendor, item, expected amount, fulfillment type, privacy disclosure, and any PII required. After ZecGuard creates a purchase, tell the user to review the dashboard approval screen.
```
