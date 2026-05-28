import { NextResponse } from "next/server";
import { loadConfig, loadState, readConfigText, refreshWalletBalance, saveState } from "@zecguard/core";

export const dynamic = "force-dynamic";

export async function GET() {
  const config = loadConfig();
  const state = loadState();

  if (config.agent.walletMode !== "mock") {
    const lastUpdate = state.wallet.balanceUpdatedAt
      ? new Date(state.wallet.balanceUpdatedAt).getTime()
      : 0;
    if (Date.now() - lastUpdate > 30_000) {
      await refreshWalletBalance(state, config);
      saveState(state);
    }
  }

  return NextResponse.json({
    config: loadConfig(),
    configText: readConfigText(),
    state
  });
}
