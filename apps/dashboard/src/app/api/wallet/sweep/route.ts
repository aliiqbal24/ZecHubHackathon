import { NextResponse } from "next/server";
import { loadConfig, sweepAgentWallet } from "@zecguard/core";

export const dynamic = "force-dynamic";

export async function POST() {
  try {
    return NextResponse.json(await sweepAgentWallet(loadConfig()));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const status = message.includes("mainReturnAddress")
      ? 400
      : message.includes("Insufficient") || message.includes("too low")
        ? 402
        : 409;
    return NextResponse.json({ error: message }, { status });
  }
}
