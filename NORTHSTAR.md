# ZecGuard Northstar

## Mission

Give Zcash a wallet that intelligent agents can use responsibly.

The final state of this project is an approval-gated Zcash spending layer for AI agents such as Codex, Claude, or other MCP-capable assistants. A user should be able to say:

> I want to fund this institution with Zcash.

The agent should then research the recipient, find the correct Zcash payment address, explain how it verified that address, prepare the exact transaction, and ask the user for confirmation before any ZEC leaves the wallet.

ZecGuard exists to make private Zcash payments usable by agents without giving agents unchecked custody or blind payment authority.

## Product Promise

An agent may:

- Interpret a user's spending intent.
- Find a recipient, vendor, institution, or payment endpoint.
- Gather evidence for the correct wallet address.
- Request quotes or prepare direct transfers.
- Check local spending policy.
- Present amount, address, memo, privacy impact, and evidence.
- Queue a payment for human approval.

An agent may not:

- Send ZEC without explicit user approval.
- Hide the recipient address, amount, memo, or source evidence.
- Bypass spending limits silently.
- Release personal information without approval.
- Treat an unverified address as safe.

The core invariant is simple:

**Agent intelligence prepares the spend. Human authority releases the spend.**

## Target User Experience

1. The user gives a natural-language goal.
   - Example: "Donate 0.02 ZEC to the Electric Coin Company."
   - Example: "Buy this research report if the vendor accepts shielded Zcash."
   - Example: "Fund this institution, but first verify the address from official sources."

2. The agent researches and prepares the payment.
   - Identifies the recipient.
   - Finds one or more candidate Zcash addresses.
   - Checks source quality.
   - Rejects weak or conflicting evidence.
   - Selects the best verified address.
   - Prepares the transaction amount and memo.

3. ZecGuard checks policy.
   - Per-transaction limit.
   - Daily and monthly budget.
   - Trusted or unknown recipient status.
   - Address format.
   - Memo size and contents.
   - Privacy and PII exposure.

4. The dashboard shows the approval request.
   - Recipient name.
   - Exact ZEC amount.
   - Exact payment address.
   - Memo.
   - Source evidence and links.
   - Policy warnings or blocks.
   - Privacy disclosure.

5. The user approves or rejects.
   - Approval sends through the configured local Zcash wallet.
   - Rejection cancels the queued spend.

6. ZecGuard stores the result.
   - Transaction id.
   - Payment status.
   - Confirmation status when available.
   - Receipt or local payment record.
   - Audit trail of what the agent believed and what the user approved.

## Why Zcash

Zcash has strong privacy properties, but private money still needs usable control surfaces. AI agents make this more urgent. If agents can search, negotiate, and buy, they also need a payment system that is:

- Private by default.
- Explicit about what is being paid.
- Hard to accidentally misuse.
- Compatible with human approval.
- Auditable locally without publishing unnecessary personal data.

ZecGuard should make Zcash feel like the natural payment rail for autonomous and semi-autonomous agents.

## Architecture Direction

ZecGuard should be built around five boundaries.

### 1. Agent Interface

Agents interact through MCP tools. They can discover vendors, request quotes, prepare payments, and inspect state.

The approval endpoint must stay outside autonomous agent control.

### 2. Recipient Verification

For direct institutional funding, agents need a recipient verification workflow:

- Search official websites and public profiles.
- Prefer first-party sources over reposts.
- Record evidence URLs and retrieval timestamps.
- Detect conflicting addresses.
- Require user review for unknown or weakly verified recipients.

The system should treat "found an address" and "verified the address" as different states.

### 3. Policy Engine

Every proposed spend must pass through local policy:

- Maximum per transaction.
- Maximum per day.
- Maximum per month.
- Trusted recipient or vendor allowlist.
- Unknown recipient warnings.
- Required human approval.
- Optional one-time override with reason.

Policy should be readable and editable in `zecguard.config.yaml`.

### 4. Wallet Adapter

Real sending belongs behind a wallet adapter. The current production direction is an external CLI wallet boundary, for example:

- `zingo-cli`
- `zallet`
- `zcash-cli` or compatible tooling

ZecGuard should never require an agent to handle wallet secrets directly. The wallet stays local; the agent gets only preparation and state tools.

### 5. Approval Dashboard

The dashboard is the user's control room. It should make the approval decision obvious:

- Who gets paid.
- How much they get.
- Which address receives funds.
- Why the agent believes the address is correct.
- What policy checks passed or failed.
- What privacy is gained or lost.
- What will happen after approval.

## Safety Principles

- No silent sends.
- No hidden recipient changes.
- No approval by prompt injection.
- No payment to addresses without visible evidence.
- No fake confidence when address evidence is weak.
- No custody inside the language model.
- No personal data release without explicit user approval.
- No irreversible action without a clear final confirmation.

## Milestones

### Milestone 1: Approval-Gated Vendor Purchases

Status: partially implemented.

- ZEC Harness vendor discovery.
- Quote request.
- Policy check.
- Dashboard approval.
- External wallet adapter.
- Receipt storage.

### Milestone 2: Direct ZEC Transfer Intents

Add a non-vendor payment path for direct funding:

- `prepare_direct_transfer` MCP tool.
- Recipient name and purpose.
- Amount in ZEC.
- Candidate address.
- Memo.
- Evidence list.
- Policy result.
- Dashboard approval request.

### Milestone 3: Recipient Address Research

Make agents good at finding the right address:

- First-party source preference.
- Evidence ranking.
- Conflict detection.
- Required evidence display in dashboard.
- Manual user correction when needed.

### Milestone 4: Real Wallet Reliability

Harden the wallet boundary:

- Better CLI presets.
- Balance checks.
- Transaction status checks.
- Confirmation polling.
- Clear wallet error messages.
- Testnet/mainnet configuration clarity.

### Milestone 5: Agent-Ready Distribution

Make it easy for a user to install and connect:

- Simple setup guide.
- MCP config examples for Codex and Claude.
- Wallet setup guide.
- Testnet walkthrough.
- Mainnet safety checklist.

## Success Criteria

ZecGuard is succeeding when a user can safely say:

> Send 0.01 ZEC to this institution if you can verify their wallet address.

And the agent can:

1. Find the likely recipient.
2. Verify the address from credible sources.
3. Prepare the transaction.
4. Explain the evidence.
5. Show the exact spend in the dashboard.
6. Wait for user approval.
7. Send ZEC through the user's local wallet.
8. Store a local record of what happened.

The user should feel that the agent is useful, but never in control of the funds.

## Northstar Sentence

**ZecGuard lets AI agents intelligently prepare private Zcash payments while keeping final spending authority with the human user.**
