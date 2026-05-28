import { NextResponse } from "next/server";
import { appendActivity, loadState, saveState, zecToZats } from "@zecguard/core";

export const dynamic = "force-dynamic";

export async function POST() {
  const state = loadState();
  state.wallet.balanceZats += zecToZats("0.10");
  appendActivity(state, {
    kind: "system",
    title: "Mock wallet topped up",
    detail: "Added 0.10 ZEC to the local demo wallet."
  });
  saveState(state);
  return NextResponse.json({ ok: true, wallet: state.wallet });
}
