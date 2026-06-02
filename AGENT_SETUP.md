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
- `start_web_purchase`
- `prepare_zec_payment`
- `review_purchase`
- `approve_and_pay_purchase`
- `claim_fulfillment`
- `get_zecguard_state`

`approve_and_pay_purchase` is destructive, non-idempotent, and can submit real ZEC when `walletMode` is `external-cli`. Do not configure your MCP client to auto-approve this tool. Inline approval relies on the agent client's normal permission prompt plus an explicit user confirmation in chat; the dashboard approval screen remains the safer fallback.

## Client Setup

Claude Code:

```bash
claude mcp add zecguard -- npm run mcp:stdio
```

Codex MCP config:

```toml
[mcp_servers.zecguard]
command = "npm"
args = ["run", "mcp:stdio"]
cwd = "C:\\SWE_Projects\\ZecHubEz"
```

Keep MCP tool approval prompts enabled, especially for `approve_and_pay_purchase`.

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

Prepare a generic ZIP-321/raw ZEC payment:

```bash
curl -X POST http://localhost:3010/mcp/call ^
  -H "content-type: application/json" ^
  -d "{\"name\":\"prepare_zec_payment\",\"args\":{\"paymentUri\":\"zcash:u1recipient0000000000000000000000000000000000000000?amount=0.003&memo=invoice-123\",\"recipientLabel\":\"Report vendor\"}}"
```

Start a web checkout or P2P purchase session:

```bash
curl -X POST http://localhost:3010/mcp/call ^
  -H "content-type: application/json" ^
  -d "{\"name\":\"start_web_purchase\",\"args\":{\"request\":\"buy a small gift card with Zcash\",\"targetUrl\":\"https://www.coinsbee.com/checkout\",\"vendorHint\":\"Coinsbee\"}}"
```

`start_web_purchase` extracts a ZIP-321 URI, visible Zcash address + amount, or QR payload text and creates an approval request. It never sends funds. If checkout needs email, country, login, captcha, or another unavailable field first, it returns `needs_user_input`.

Review the exact spend before approval:

```bash
curl -X POST http://localhost:3010/mcp/call ^
  -H "content-type: application/json" ^
  -d "{\"name\":\"review_purchase\",\"args\":{\"purchaseId\":\"p_...\"}}"
```

Submit payment only after explicit user approval:

```bash
curl -X POST http://localhost:3010/mcp/call ^
  -H "content-type: application/json" ^
  -d "{\"name\":\"approve_and_pay_purchase\",\"args\":{\"purchaseId\":\"p_...\"}}"
```

## Agent Prompt

Use this instruction with an agent connected to ZecGuard:

```text
You can request ZEC purchases through ZecGuard, but you may not approve payment. Before requesting a quote, identify the vendor, item, expected amount, fulfillment type, privacy disclosure, and any PII required. After ZecGuard creates a purchase, tell the user to review the dashboard approval screen.
```

For inline MCP approval, use this stricter instruction:

```text
You may prepare and review ZEC payments through ZecGuard. Before calling approve_and_pay_purchase, show the exact ZEC amount, recipient address, memo, expiry, policy result, and whether fulfillment is automatic or only a local receipt. Call approve_and_pay_purchase only after I explicitly confirm the payment in chat and the MCP client permission prompt is shown.
```
