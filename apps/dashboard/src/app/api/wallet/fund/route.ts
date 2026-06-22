import { NextResponse } from "next/server";
import { appendActivity, loadConfig, loadState, refreshWalletBalance, saveState } from "@agentzcash/core";

export const dynamic = "force-dynamic";

export async function POST() {
  const config = loadConfig();
  const state = loadState();

  await refreshWalletBalance(state, config);
  appendActivity(state, {
    kind: "system",
    title: "Wallet balance refreshed",
    detail: state.wallet.balanceSource === "live"
      ? "Balance refreshed from the configured external wallet."
      : "External wallet balance could not be refreshed; showing 0 ZEC until a live balance is available."
  });
  saveState(state);
  return NextResponse.json({
    ok: true,
    wallet: state.wallet,
    message: "Balance refreshed from wallet."
  });
}
