import { NextRequest, NextResponse } from "next/server";
import { approveAndPayPurchase, loadConfig } from "@zecguard/core";

export const dynamic = "force-dynamic";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = (await request.json().catch(() => ({}))) as {
    profileId?: string;
    overrideReason?: string;
  };

  try {
    const result = await approveAndPayPurchase(loadConfig(), {
      purchaseId: id,
      profileId: body.profileId,
      overrideReason: body.overrideReason,
      approvedBy: "dashboard"
    });
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const status = message.includes("not found")
      ? 404
      : message.includes("Insufficient")
        ? 402
        : message.includes("Vendor verification failed")
          ? 502
          : 409;
    return NextResponse.json({ error: message }, { status });
  }
}
