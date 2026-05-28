const ZATS_PER_ZEC = 100_000_000;

export function zecToZats(value: string | number): number {
  const text = String(value).trim();
  if (!/^\d+(\.\d{1,8})?$/.test(text)) {
    throw new Error(`Invalid ZEC amount: ${text}`);
  }

  const parts = text.split(".");
  const whole = parts[0] ?? "0";
  const fractional = parts[1] ?? "";
  const zats =
    Number.parseInt(whole, 10) * ZATS_PER_ZEC +
    Number.parseInt(fractional.padEnd(8, "0"), 10);

  if (!Number.isSafeInteger(zats)) {
    throw new Error(`ZEC amount is too large: ${text}`);
  }

  return zats;
}

export function zatsToZec(zats: number): string {
  if (!Number.isSafeInteger(zats) || zats < 0) {
    throw new Error(`Invalid zatoshi amount: ${zats}`);
  }

  const whole = Math.floor(zats / ZATS_PER_ZEC);
  const fractional = String(zats % ZATS_PER_ZEC).padStart(8, "0").replace(/0+$/, "");
  return fractional ? `${whole}.${fractional}` : String(whole);
}

export function formatZec(zats: number): string {
  return `${zatsToZec(zats)} ZEC`;
}
