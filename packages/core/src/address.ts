export function isLikelyZcashAddress(value: string | undefined): value is string {
  if (!value) return false;
  return /^(u1|utest|zs|ztestsapling|t1|t3|tm|tex)[a-zA-Z0-9]{20,}$/.test(value.trim());
}

export function assertLikelyZcashAddress(value: string | undefined, label = "Zcash address"): string {
  const trimmed = value?.trim();
  if (!isLikelyZcashAddress(trimmed)) {
    throw new Error(`${label} is missing or does not look like a supported Zcash address.`);
  }
  return trimmed;
}

export function addressFingerprint(address: string | undefined): string | undefined {
  if (!address) return undefined;
  const trimmed = address.trim();
  if (trimmed.length <= 18) return trimmed;
  return `${trimmed.slice(0, 8)}...${trimmed.slice(-10)}`;
}

export function addressConfirmationSuffix(address: string | undefined, length = 10): string | undefined {
  if (!address) return undefined;
  return address.trim().slice(-length);
}
