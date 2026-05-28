# ZecGuard Hackathon Submission

## Project

ZecGuard is a private payment firewall for AI agents. It lets an agent request purchases from ZEC-compatible vendors while the human keeps custody, policy control, final approval, privacy visibility, and signed receipts.

## Why Zcash

AI agents need economic agency, but public payment rails expose the user, vendor graph, budget, and strategy. Zcash gives the settlement layer a privacy primitive that fits agent commerce: quote, approve, pay, verify, fulfill, and keep a private receipt without publishing the economic graph.

## What Works

- Agent-facing MCP server.
- Local dashboard for payment approval.
- YAML policy with transaction, daily, and monthly limits.
- ZEC Harness vendor protocol.
- Demo vendor for digital AI service and physical goods.
- Approval-gated PII release.
- Mock ZEC wallet and payment ledger.
- Vendor verification before fulfillment.
- Signed private receipts.

## Demo Script

1. Start the stack with `npm run dev`.
2. Open `http://localhost:3000`.
3. Show the YAML policy and agent wallet balance.
4. Ask the agent to buy a private AI briefing.
5. Show the pending approval with amount, vendor, memo purpose, terms, policy checks, and privacy label.
6. Approve the purchase.
7. Show payment submission, vendor verification, fulfillment, and private receipt.
8. Repeat with the physical item and show the PII disclosure before approval.

## Verification

```bash
npm test
npm run typecheck
npm run build
npm run demo:verify
```

## What Is Mocked

The wallet uses a mock ZEC balance, and the vendor verifies by scanning the local mock payment ledger. The adapter boundary for a real Zcash CLI exists, but this machine does not currently have a Zcash wallet backend installed.

## Next Mainnet Step

Install and fund a wallet backend, set `walletMode: external-cli`, configure `externalCliCommand`, and replace the vendor mock ledger watcher with wallet/viewing-key payment detection.
