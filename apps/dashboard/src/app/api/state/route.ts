import { NextResponse } from "next/server";
import { loadConfig, loadState, readConfigText } from "@zecguard/core";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({
    config: loadConfig(),
    configText: readConfigText(),
    state: loadState()
  });
}
