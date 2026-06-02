import { NextResponse } from "next/server";
import { appendActivity, loadConfig, loadState, runAgentWalletPreflight, saveState, zecToZats } from "@zecguard/core";

export const dynamic = "force-dynamic";

export async function POST() {
  const config = loadConfig();
  const state = loadState();

  if (config.agentWallet.backend !== "mock") {
    try {
      await runAgentWalletPreflight(state, config);
      saveState(state);
      return NextResponse.json({
        ok: true,
        wallet: state.agentWallet,
        message: "Wallet preflight and balance refresh completed."
      });
    } catch (err) {
      saveState(state);
      return NextResponse.json(
        {
          ok: false,
          wallet: state.agentWallet,
          error: err instanceof Error ? err.message : String(err)
        },
        { status: 409 }
      );
    }
  }

  state.agentWallet.balanceZats += zecToZats("0.10");
  state.agentWallet.spendableZats += zecToZats("0.10");
  state.agentWallet.balanceUpdatedAt = new Date().toISOString();
  appendActivity(state, {
    kind: "system",
    title: "Mock wallet topped up",
    detail: "Added 0.10 ZEC to the local demo wallet."
  });
  saveState(state);
  return NextResponse.json({ ok: true, wallet: state.agentWallet });
}
