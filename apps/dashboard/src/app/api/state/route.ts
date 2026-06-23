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
  try {
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
      config,
      configText: readConfigText(),
      state
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load AgentZcash state.";
    return NextResponse.json(
      {
        ok: false,
        error: message,
        setupCommand: "npx agentzcash init"
      },
      { status: message.startsWith("Missing AgentZcash config") ? 503 : 500 }
    );
  }
}
