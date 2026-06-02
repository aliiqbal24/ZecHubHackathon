# Agent Setup

ZecGuard exposes an MCP stdio server for Claude, Codex, and generic MCP clients. Normal users should run the packaged CLI rather than pointing clients at a cloned repository.

## One-Command Test

```bash
npx -y @zechub/zecguard doctor
```

`doctor` creates the user-level config/state if needed and reports Node, package, dashboard, MCP, Zingo CLI, wallet path, and setup-wizard status.

## MCP Command

Use this command in MCP clients:

```bash
npx -y @zechub/zecguard mcp
```

The command starts the local dashboard on `127.0.0.1`, falls back to the next available port when `3000` is occupied, logs dashboard diagnostics to stderr, and keeps stdout reserved for MCP JSON-RPC.

## Claude

```bash
claude mcp add zecguard -- npx -y @zechub/zecguard mcp
```

## Codex

```toml
[mcp_servers.zecguard]
command = "npx"
args = ["-y", "@zechub/zecguard", "mcp"]
```

## Generic MCP JSON

```json
{
  "mcpServers": {
    "zecguard": {
      "command": "npx",
      "args": ["-y", "@zechub/zecguard", "mcp"]
    }
  }
}
```

## First-Run Wallet Wizard

On first startup, open the dashboard URL printed to stderr. ZecGuard returns `setup_required` from purchase-preparation tools until the real-wallet checklist is complete:

- Zingo CLI path is configured and passes preflight.
- Wallet data directory exists.
- Deposit address parses.
- Main return address is configured and suffix-verified.
- Backup/recovery confirmations are checked.
- A small test deposit is observed.
- A small test sweep completes.

`approve_and_pay_purchase` remains destructive, non-idempotent, and can submit real ZEC. Keep MCP tool approval prompts enabled and call it only after explicit user approval in chat.

## Developer From Source

For local development in a cloned checkout:

```bash
npm install
npm run dev
```

Source services:

- Dashboard: `http://localhost:3000`
- MCP HTTP server: `http://localhost:3010`
- Demo vendor: `http://localhost:3020`

Source-only MCP stdio:

```bash
npm run mcp:stdio
```

Use source commands only when actively developing the repository. Normal agent setup should use the `npx` command above and does not need a working-directory entry.

