import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const MCP_SERVER_URL = process.env.MCP_SERVER_URL ?? "http://localhost:3010";
const DEMO_VENDOR_URL = process.env.DEMO_VENDOR_URL ?? "http://localhost:3020";

function inferItemId(requestText: string): string {
  const text = requestText.toLowerCase();
  if (text.includes("kit") || text.includes("hardware") || text.includes("ship") || text.includes("physical")) {
    return "privacy-kit";
  }
  return "ai-brief";
}

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => ({}))) as {
    requestText?: string;
  };
  const requestText =
    body.requestText?.trim() ||
    "Buy a private AI briefing about ZEC-native agent commerce.";

  const response = await fetch(`${MCP_SERVER_URL}/mcp/call`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      name: "request_quote",
      args: {
        vendorUrl: DEMO_VENDOR_URL,
        itemId: inferItemId(requestText),
        options: {
          prompt: requestText
        }
      }
    })
  });

  const json = await response.json();
  return NextResponse.json(json, { status: response.ok ? 200 : 502 });
}
