# Agent Instructions

## AgentZcash Payment Safety

Use the `agentzcash` MCP server for ZEC payment requests. Submit payments only through AgentZcash policy-gated tools.

For a direct shielded transfer:

1. Call `prepare_direct_transfer` with recipient name, exact shielded-capable Zcash address, amount in ZEC, memo, purpose, evidence URLs, and verification notes.
2. Use only shielded-capable recipient addresses that start with `u1`, `utest`, `zs`, or `ztestsapling`. Transparent-only `t1` and `t3` addresses are blocked.
3. If the tool returns `approvalUrl`, return it to the user and tell them to review and approve or reject the payment in the AgentZcash dashboard.
4. If the tool returns `payment_submitted`, `pending_confirmation`, or `receipted`, report that AgentZcash submitted the payment under local policy.
5. Call `get_agentzcash_state` and report whether the transfer is `awaiting_approval`, `pending_confirmation`, `receipted`, `payment_failed`, or `verification_failed`.

If policy blocks the request, report the policy result and do not suggest bypassing AgentZcash policy.
