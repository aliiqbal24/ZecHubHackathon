import { NextResponse } from "next/server";
import { appendActivity, loadConfig, loadState, refreshWalletBalance, saveState, zecToZats } from "@zecguard/core";

export const dynamic = "force-dynamic";

export async function POST() {
  const config = loadConfig();
  const state = loadState();

  if (config.agent.walletMode !== "mock") {
    await refreshWalletBalance(state, config);
    saveState(state);
    return NextResponse.json({
      ok: true,
      wallet: state.wallet,
      message: "Balance refreshed from wallet."
    });
  }

  state.wallet.balanceZats += zecToZats("0.10");
  appendActivity(state, {
    kind: "system",
    title: "Mock wallet topped up",
    detail: "Added 0.10 ZEC to the local demo wallet."
  });
  saveState(state);
  return NextResponse.json({ ok: true, wallet: state.wallet });
}
