# Agent Instructions

## AgentZcash Payment Safety

Use the `agentzcash` MCP server for ZEC payment requests. Never approve, reject, submit, send, or otherwise complete a payment autonomously.

For a direct shielded transfer:

1. Call `prepare_direct_transfer` with recipient name, exact shielded-capable Zcash address, amount in ZEC, memo, purpose, evidence URLs, and verification notes.
2. Use only shielded-capable recipient addresses that start with `u1`, `utest`, `zs`, or `ztestsapling`. Transparent-only `t1` and `t3` addresses are blocked.
3. Return the `approvalUrl` from the tool result to the user.
4. Tell the user to review and approve or reject the payment in the AgentZcash dashboard.
5. After the user says they approved it, call `get_agentzcash_state` and report whether the transfer is `pending_confirmation`, `receipted`, `payment_failed`, or `verification_failed`.

If policy blocks the request, report the policy result and do not suggest bypassing dashboard approval.
