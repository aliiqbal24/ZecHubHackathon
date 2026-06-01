# Codex Instructions

These instructions apply to the whole ZecGuard repository.

## Default Git Workflow

- For code or documentation changes in this app, Codex should finish by committing and pushing its own changes to the current branch on `origin`.
- Before committing, run the most relevant verification for the change. Prefer `npm test`, `npm run typecheck`, `npm run build`, or a narrower workspace command when that is the practical fit.
- Stage only the files changed for the current task. Do not stage, revert, or rewrite unrelated local changes already present in the worktree.
- Use a concise commit message that describes the user-facing change.
- Push with `git push origin HEAD` unless the user gives a different branch or remote.
- In the final response, include the verification run, the commit hash, and whether the push succeeded.

## Exceptions

- Do not commit or push when the user asks for review-only work, asks not to push, or explicitly says the work is experimental/WIP.
- If verification cannot run, commit only when the risk is clear and report the reason.
- If pushing fails because of authentication, network access, branch protection, or another external constraint, leave the local commit in place and report the exact blocker.

## Safety Notes

- `approve_and_pay_purchase` can submit real ZEC when `walletMode` is `external-cli`. Only call it after explicit user approval in chat and the normal MCP/tool permission prompt.
