import { NextResponse } from "next/server";
import { appendActivity, loadConfig, loadState, refreshWalletBalance, saveState, zecToZats } from "@zecguard/core";

export const dynamic = "force-dynamic";

export async function POST() {
  const config = loadConfig();
  const state = loadState();

  if (config.agentWallet.backend !== "mock") {
    await refreshWalletBalance(state, config);
    saveState(state);
    return NextResponse.json({
      ok: true,
      wallet: state.agentWallet,
      message: "Balance refreshed from wallet."
    });
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
