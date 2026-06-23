import { NextRequest, NextResponse } from "next/server";
import { loadConfig, readConfigText, saveConfig } from "@agentzcash/core";

export const dynamic = "force-dynamic";

interface SettingsRequestBody {
  requireEveryPayment?: unknown;
  perTransactionZec?: unknown;
  dailyZec?: unknown;
  monthlyZec?: unknown;
}

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => ({}))) as SettingsRequestBody;
  const parsed = parseSettings(body);

  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  const config = loadConfig();
  config.approval.requireEveryPayment = parsed.value.requireEveryPayment;
  config.spending.perTransactionZec = parsed.value.perTransactionZec;
  config.spending.dailyZec = parsed.value.dailyZec;
  config.spending.monthlyZec = parsed.value.monthlyZec;
  saveConfig(config);

  return NextResponse.json({
    ok: true,
    config,
    configText: readConfigText()
  });
}

function parseSettings(body: SettingsRequestBody):
  | {
      ok: true;
      value: {
        requireEveryPayment: boolean;
        perTransactionZec: string;
        dailyZec: string;
        monthlyZec: string;
      };
    }
  | { ok: false; error: string } {
  if (typeof body.requireEveryPayment !== "boolean") {
    return { ok: false, error: "Payment mode is invalid." };
  }

  const perTransactionZec = parsePositiveZec("Per-transaction limit", body.perTransactionZec);
  if (!perTransactionZec.ok) return perTransactionZec;

  const dailyZec = parsePositiveZec("Daily limit", body.dailyZec);
  if (!dailyZec.ok) return dailyZec;

  const monthlyZec = parsePositiveZec("Monthly limit", body.monthlyZec);
  if (!monthlyZec.ok) return monthlyZec;

  return {
    ok: true,
    value: {
      requireEveryPayment: body.requireEveryPayment,
      perTransactionZec: perTransactionZec.value,
      dailyZec: dailyZec.value,
      monthlyZec: monthlyZec.value
    }
  };
}

function parsePositiveZec(label: string, value: unknown): { ok: true; value: string } | { ok: false; error: string } {
  if (typeof value !== "string") {
    return { ok: false, error: `${label} must be a ZEC decimal.` };
  }
  const trimmed = value.trim();
  if (!/^\d+(\.\d{1,8})?$/.test(trimmed) || Number(trimmed) <= 0) {
    return { ok: false, error: `${label} must be a positive ZEC decimal with up to 8 decimals.` };
  }
  return { ok: true, value: trimmed };
}
