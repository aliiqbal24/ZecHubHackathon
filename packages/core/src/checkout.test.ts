import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parseContacts, parseP2PRequest, resolveContact } from "./contacts.js";
import { startWebPurchase } from "./checkout.js";
import { loadState } from "./state.js";

const checkoutAddress = "u1checkout0000000000000000000000000000000000000000000";
const aliAddress = "u1alicontact00000000000000000000000000000000000000000";

let tempDir: string;
let previousConfig: string | undefined;
let previousState: string | undefined;
let previousHome: string | undefined;
let previousContacts: string | undefined;

describe("web purchase sessions", () => {
  beforeEach(() => {
    previousConfig = process.env.ZECGUARD_CONFIG;
    previousState = process.env.ZECGUARD_STATE_PATH;
    previousHome = process.env.ZECGUARD_HOME;
    previousContacts = process.env.ZECGUARD_CONTACTS_PATH;
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "zecguard-checkout-"));
    process.env.ZECGUARD_HOME = path.join(tempDir, ".zecguard");
    process.env.ZECGUARD_CONFIG = path.join(tempDir, "zecguard.config.yaml");
    process.env.ZECGUARD_STATE_PATH = path.join(tempDir, "state.json");
    process.env.ZECGUARD_CONTACTS_PATH = path.join(tempDir, "contacts.md");
    writeConfig(process.env.ZECGUARD_CONFIG);
    fs.writeFileSync(process.env.ZECGUARD_CONTACTS_PATH, `- Ali: ${aliAddress} trusted\n`, "utf8");
  });

  afterEach(() => {
    restoreEnv("ZECGUARD_CONFIG", previousConfig);
    restoreEnv("ZECGUARD_STATE_PATH", previousState);
    restoreEnv("ZECGUARD_HOME", previousHome);
    restoreEnv("ZECGUARD_CONTACTS_PATH", previousContacts);
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("creates an approval request from a generic checkout fixture", async () => {
    const result = await startWebPurchase({
      request: "buy the test voucher",
      targetUrl: "https://shop.example/checkout",
      checkoutHtml: `
        <h1>Zcash checkout</h1>
        <p>Send 0.003 ZEC to ${checkoutAddress}</p>
        <p>Memo: order-abc</p>
        <p>Status: https://shop.example/orders/abc</p>
      `
    });

    const saved = loadState().purchases.find((purchase) => purchase.id === result.purchaseId);

    expect(result.checkoutStatus).toBe("invoice_found");
    expect(result.nextAction).toBe("review_purchase");
    expect(saved?.payTo).toBe(checkoutAddress);
    expect(saved?.amountZec).toBe("0.003");
  });

  it("pauses when checkout needs user input before invoice extraction", async () => {
    const result = await startWebPurchase({
      request: "buy the test voucher",
      checkoutHtml: `<form><input type="email" name="email" /></form>`
    });

    expect(result.checkoutStatus).toBe("needs_user_input");
    expect(result.needsUserInput?.field).toBe("email");
  });

  it("resolves a P2P request from local contacts", async () => {
    const result = await startWebPurchase({ request: "send Ali 0.003 ZEC" });
    const saved = loadState().purchases.find((purchase) => purchase.id === result.purchaseId);

    expect(result.checkoutStatus).toBe("invoice_found");
    expect(saved?.vendorName).toBe("Ali");
    expect(saved?.payTo).toBe(aliAddress);
    expect(saved?.policy.checks.find((check) => check.id === "recipient")?.severity).toBe("pass");
  });
});

describe("contacts", () => {
  it("parses aliases and resolves exact aliases", () => {
    const contacts = parseContacts(`- Ali, alice: ${aliAddress} trusted`);

    expect(resolveContact("alice", contacts)[0]?.name).toBe("Ali");
    expect(contacts[0]?.trusted).toBe(true);
  });

  it("parses natural-language P2P requests", () => {
    expect(parseP2PRequest("send Ali 0.03 ZEC")).toEqual({
      contactName: "Ali",
      amountZec: "0.03",
      memo: "send Ali 0.03 ZEC"
    });
  });
});

function writeConfig(file: string) {
  fs.writeFileSync(
    file,
    [
      "agent:",
      "  name: Test",
      "  walletMode: mock",
      "  walletAddress: u1testwallet000000000000000000000000000000000000000",
      "agentWallet:",
      "  backend: mock",
      "  label: Test Wallet",
      "  walletId: agent-default",
      "  zingoCliPath: zingo-cli",
      "  mainReturnAddress: u1mainreturn000000000000000000000000000000000000",
      "  maxRealWalletBalanceZec: \"0.05\"",
      "spending:",
      "  perTransactionZec: \"0.05\"",
      "  dailyZec: \"0.15\"",
      "  monthlyZec: \"1.00\"",
      "approval:",
      "  requireEveryPayment: true",
      "  allowOneTimeOverride: true",
      "vendors:",
      "  allowUnknownVendors: true",
      "  trusted:",
      "    - https://shop.example",
      "privacy:",
      "  showPrivacyLabel: true",
      "shippingProfiles: []",
      "verification:",
      "  mode: mock",
      "  minConfirmations: 1",
      ""
    ].join("\n")
  );
}

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}
