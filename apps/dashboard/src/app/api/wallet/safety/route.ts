import { NextResponse } from "next/server";
import {
  addressConfirmationSuffix,
  appendActivity,
  buildAgentWalletSafetyReport,
  loadConfig,
  loadState,
  runAgentWalletPreflight,
  saveState
} from "@zecguard/core";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const config = loadConfig();
  const state = loadState();

  try {
    const body = (await request.json().catch(() => ({}))) as {
      action?: string;
      backupCreated?: boolean;
      backupStoredOffline?: boolean;
      confirmation?: string;
    };

    if (body.action === "preflight") {
      await runAgentWalletPreflight(state, config);
      appendActivity(state, {
        kind: "system",
        title: "Agent wallet preflight passed",
        detail: "Zingo CLI, wallet data path, deposit address, and balance refresh completed."
      });
    } else if (body.action === "verify-return-address") {
      const expected = addressConfirmationSuffix(config.agentWallet.mainReturnAddress);
      if (!expected || body.confirmation?.trim() !== expected) {
        throw new Error(`Return address confirmation must match the last ${expected?.length ?? 10} characters.`);
      }
      state.agentWallet.mainReturnAddress = config.agentWallet.mainReturnAddress;
      state.agentWallet.safety.returnAddressVerified = true;
      state.agentWallet.safety.updatedAt = new Date().toISOString();
      appendActivity(state, {
        kind: "system",
        title: "Return address verified",
        detail: "Main wallet return address suffix was confirmed in the dashboard."
      });
    } else {
      state.agentWallet.safety.backupCreated = Boolean(body.backupCreated);
      state.agentWallet.safety.backupStoredOffline = Boolean(body.backupStoredOffline);
      state.agentWallet.safety.updatedAt = new Date().toISOString();
    }

    saveState(state);
    return NextResponse.json({
      ok: true,
      wallet: state.agentWallet,
      safety: buildAgentWalletSafetyReport(state.agentWallet, config)
    });
  } catch (err) {
    saveState(state);
    return NextResponse.json(
      {
        ok: false,
        wallet: state.agentWallet,
        safety: buildAgentWalletSafetyReport(state.agentWallet, config),
        error: err instanceof Error ? err.message : String(err)
      },
      { status: 400 }
    );
  }
}
