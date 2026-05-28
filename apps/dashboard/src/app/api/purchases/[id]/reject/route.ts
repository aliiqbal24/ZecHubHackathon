import { NextResponse } from "next/server";
import { appendActivity, loadState, saveState } from "@zecguard/core";

export const dynamic = "force-dynamic";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const state = loadState();
  const purchase = state.purchases.find((item) => item.id === id);
  if (!purchase) {
    return NextResponse.json({ error: "Purchase not found" }, { status: 404 });
  }

  purchase.status = "rejected";
  purchase.rejectedAt = new Date().toISOString();
  purchase.updatedAt = purchase.rejectedAt;
  appendActivity(state, {
    kind: "approval",
    title: "User rejected purchase",
    detail: `${purchase.itemTitle} was not paid.`,
    purchaseId: purchase.id
  });
  saveState(state);

  return NextResponse.json({ ok: true, purchase });
}
