# AgentZcash Agent Instructions

These instructions apply to the whole AgentZcash repository.

## Default Git Workflow

- For code or documentation changes in this app, Codex should finish by committing and pushing its own changes to the current branch on `origin` unless the user asks otherwise.
- Before committing, run the most relevant verification for the change. Prefer `npm test`, `npm run typecheck`, `npm run build`, or a narrower workspace command when that is the practical fit.
- Stage only the files changed for the current task. Do not stage, revert, or rewrite unrelated local changes already present in the worktree.
- Use a concise commit message that describes the user-facing change.
- Push with `git push origin HEAD` unless the user gives a different branch or remote.
- In the final response, include the verification run, the commit hash, and whether the push succeeded.

## Exceptions

- Do not commit or push when the user asks for review-only work, asks not to push, or explicitly says the work is experimental/WIP.
- If verification cannot run, commit only when the risk is clear and report the reason.
- If pushing fails because of authentication, network access, branch protection, or another external constraint, leave the local commit in place and report the exact blocker.

## Payment Safety

Use the `agentzcash` MCP server for ZEC payments. Never approve or submit a payment autonomously.

For a direct shielded transfer:

1. Call `prepare_direct_transfer` with recipient name, exact shielded-capable Zcash address, amount in ZEC, memo, purpose, evidence URLs, and verification notes.
2. Return the `approvalUrl` from the tool result to the user.
3. Tell the user to review and approve or reject the payment in the AgentZcash dashboard.
4. After approval, use `get_agentzcash_state` to confirm the local receipt or payment failure.

Direct transfers require a shielded-capable recipient address (`u1`, `utest`, `zs`, or `ztestsapling`). Transparent-only `t1` and `t3` addresses are intentionally blocked for direct agent transfers.
