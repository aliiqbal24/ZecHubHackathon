import fs from "node:fs";
import path from "node:path";
import { isLikelyZcashAddress } from "./address.js";
import { getZecGuardHome } from "./config.js";
import type { ContactRecord } from "./types.js";

const DEFAULT_CONTACTS = `# ZecGuard contacts

Add local trusted recipients here. Format:

- Ali: u1alilocalcontact000000000000000000000000000000000000000 trusted
`;

export function contactsPath(): string {
  return process.env.ZECGUARD_CONTACTS_PATH ?? path.join(getZecGuardHome(), "contacts.md");
}

export function ensureContactsFile(): string {
  const file = contactsPath();
  if (!fs.existsSync(file)) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, DEFAULT_CONTACTS, "utf8");
  }
  return file;
}

export function loadContacts(): ContactRecord[] {
  const file = ensureContactsFile();
  return parseContacts(fs.readFileSync(file, "utf8"));
}

export function parseContacts(markdown: string): ContactRecord[] {
  const contacts: ContactRecord[] = [];
  for (const rawLine of markdown.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    const match = line.match(/^[-*]\s*([^:]+):\s*((?:u1|utest|zs|ztestsapling|t1|t3|tm|tex)[a-zA-Z0-9]{20,})(.*)$/i);
    if (!match) continue;

    const names = (match[1] ?? "")
      .split(/[|,]/)
      .map((item) => item.trim())
      .filter(Boolean);
    const address = match[2]?.trim() ?? "";
    if (!names.length || !isLikelyZcashAddress(address)) continue;

    contacts.push({
      name: names[0]!,
      aliases: names,
      address,
      trusted: /\btrusted\b/i.test(match[3] ?? "")
    });
  }
  return contacts;
}

export function resolveContact(name: string, contacts = loadContacts()): ContactRecord[] {
  const normalized = normalizeName(name);
  return contacts.filter((contact) =>
    contact.aliases.some((alias) => normalizeName(alias) === normalized)
  );
}

export function parseP2PRequest(request: string): { contactName: string; amountZec: string; memo: string } | undefined {
  const match = request.match(/\b(?:send|pay)\s+(.+?)\s+([0-9]+(?:\.[0-9]{1,8})?)\s*ZEC\b/i);
  if (!match) return undefined;

  return {
    contactName: (match[1] ?? "").trim(),
    amountZec: match[2] ?? "",
    memo: request.trim()
  };
}

function normalizeName(name: string): string {
  return name.trim().toLowerCase().replace(/^@/, "");
}
