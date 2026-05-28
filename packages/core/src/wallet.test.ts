import { describe, expect, it } from "vitest";
import { buildExternalCliInvocation } from "./wallet.js";
import { zecToZats } from "./money.js";

const purchase = {
  payTo: "u1vendor000000000000000000000000000000000000000000",
  amountZats: zecToZats("0.003"),
  memo: "ZECGUARD:q_123:ai-brief"
};

describe("external wallet invocation", () => {
  it("fills placeholders without shell interpolation", () => {
    const result = buildExternalCliInvocation("zingo-cli send --recipient {to} --value {amount} --memo {memo}", purchase);
    expect(result.command).toBe("zingo-cli");
    expect(result.args).toEqual([
      "send",
      "--recipient",
      purchase.payTo,
      "--value",
      "0.003",
      "--memo",
      purchase.memo
    ]);
  });

  it("falls back to generic appended flags", () => {
    const result = buildExternalCliInvocation("mock-wallet send", purchase);
    expect(result).toEqual({
      command: "mock-wallet",
      args: ["send", "--to", purchase.payTo, "--amount", "0.003", "--memo", purchase.memo]
    });
  });
});
