import { createHash, timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { executePaymentWithLock, loadState } from "@agentzcash/core";

export const dynamic = "force-dynamic";

interface ApprovalRequestBody {
  profileId?: string;
  overrideReason?: string;
  approvalToken?: string;
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = (await request.json().catch(() => ({}))) as ApprovalRequestBody;
  const state = loadState();
  const purchase = state.purchases.find((item) => item.id === id);

  if (!purchase) {
    return NextResponse.json({ error: "Purchase not found" }, { status: 404 });
  }

  const requestSafety = validateLocalApprovalRequest(request);
  if (!requestSafety.ok) {
    return NextResponse.json({ error: requestSafety.error }, { status: 403 });
  }
  if (!validateApprovalToken(purchase.approvalTokenHash, body.approvalToken)) {
    return NextResponse.json({ error: "Open the AgentZcash approval URL before approving this payment." }, { status: 403 });
  }

  const result = await executePaymentWithLock(id, {
    actor: "user",
    profileId: body.profileId,
    overrideReason: body.overrideReason
  });

  if (!result.ok) {
    return NextResponse.json({ error: result.error, purchase: result.purchase }, { status: result.status });
  }

  return NextResponse.json({
    ok: true,
    purchase: result.purchase,
    alreadyProcessed: result.alreadyProcessed,
    confirmationPending: result.confirmationPending
  });
}

function validateLocalApprovalRequest(request: NextRequest): { ok: true } | { ok: false; error: string } {
  const host = request.headers.get("host") ?? request.nextUrl.host;
  if (!host || !isLocalHost(host)) {
    return { ok: false, error: "Approval requests must target the local AgentZcash dashboard." };
  }

  const origin = request.headers.get("origin");
  if (origin) {
    try {
      const originUrl = new URL(origin);
      if (!isLocalHost(originUrl.host)) {
        return { ok: false, error: "Cross-site approval requests are blocked." };
      }
    } catch {
      return { ok: false, error: "Invalid approval request origin." };
    }
  }

  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite && fetchSite !== "same-origin" && fetchSite !== "none") {
    return { ok: false, error: "Cross-site approval requests are blocked." };
  }

  return { ok: true };
}

function isLocalHost(host: string): boolean {
  const hostname = host.startsWith("[") ? host.slice(1, host.indexOf("]")) : host.split(":")[0];
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
}

function validateApprovalToken(expectedHash: string | undefined, token: string | undefined): boolean {
  if (!expectedHash || !token) return false;

  const actualHash = createHash("sha256").update(token, "utf8").digest("hex");
  const expected = Buffer.from(expectedHash, "hex");
  const actual = Buffer.from(actualHash, "hex");
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
