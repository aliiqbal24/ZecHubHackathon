import { NextResponse } from "next/server";
import {
  loadConfig,
  loadState,
  readConfigText,
  refreshPendingDirectTransferConfirmations,
  refreshWalletBalance,
  saveState
} from "@agentzcash/core";

export const dynamic = "force-dynamic";

export async function GET() {
  const config = loadConfig();
  const state = loadState();
  let changed = false;

  const lastUpdate = state.wallet.balanceUpdatedAt
    ? new Date(state.wallet.balanceUpdatedAt).getTime()
    : 0;
  if (Date.now() - lastUpdate > 30_000) {
    await refreshWalletBalance(state, config);
    changed = true;
  }
  if (await refreshPendingDirectTransferConfirmations(state, config)) {
    changed = true;
  }
  if (changed) {
    saveState(state);
  }

  return NextResponse.json({
    config: loadConfig(),
    configText: readConfigText(),
    state
  });
}
