import { NextResponse } from "next/server";
import { loadConfig, readConfigText, writeConfig } from "@zecguard/core";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    writeConfig(body);
    return NextResponse.json({
      config: loadConfig(),
      configText: readConfigText()
    });
  } catch (caught) {
    return NextResponse.json(
      {
        ok: false,
        error: formatConfigError(caught)
      },
      { status: 400 }
    );
  }
}

function formatConfigError(caught: unknown): string {
  if (caught && typeof caught === "object" && "issues" in caught && Array.isArray(caught.issues)) {
    return caught.issues
      .map((issue: { path?: Array<string | number>; message?: string }) => {
        const path = issue.path?.length ? issue.path.join(".") : "config";
        return `${path}: ${issue.message ?? "Invalid value"}`;
      })
      .join("\n");
  }

  return caught instanceof Error ? caught.message : "Invalid config.";
}
