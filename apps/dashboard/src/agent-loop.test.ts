import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { NextRequest } from "next/server";
import { afterEach, describe, expect, it } from "vitest";
import { loadState } from "@agentzcash/core";
import { getAgentZcashState, prepareDirectTransfer } from "../../mcp-server/src/tools.js";
import { POST as approvePurchase } from "./app/api/purchases/[id]/approve/route.js";

const originalHome = process.env.AGENTZCASH_HOME;
const originalConfig = process.env.AGENTZCASH_CONFIG;
const originalStatePath = process.env.AGENTZCASH_STATE_PATH;
const originalFakeConfirmationFile = process.env.AGENTZCASH_FAKE_CONFIRMATION_FILE;

let tempDir: string | undefined;

afterEach(() => {
  restoreEnv("AGENTZCASH_HOME", originalHome);
  restoreEnv("AGENTZCASH_CONFIG", originalConfig);
  restoreEnv("AGENTZCASH_STATE_PATH", originalStatePath);
  restoreEnv("AGENTZCASH_FAKE_CONFIRMATION_FILE", originalFakeConfirmationFile);

  if (tempDir) {
    fs.rmSync(tempDir, { recursive: true, force: true });
    tempDir = undefined;
  }
});

describe("agentic shielded transfer loop", () => {
  it("queues a direct transfer through MCP and stores a confirmed receipt after dashboard approval", async () => {
    const { home } = setupTempAgentHome({ txStatus: "1" });

    const prepared = await prepareDirectTransfer({
      recipientName: "Alice",
      amountZec: "0.01",
      address: "u1recipient0000000000000000000000000000000000000000",
      memo: "agent-approved test transfer",
      purpose: "Integration smoke test",
      evidenceUrls: ["https://example.com/invoice"],
      agentVerificationNotes: "Address and amount copied from the invoice."
    });

    expect(prepared.status).toBe("awaiting_approval");
    expect(prepared.approvalUrl).toContain("http://localhost:3000/?purchase=");

    const response = await approvePurchase(
      new NextRequest(`http://localhost/api/purchases/${prepared.purchaseId}/approve`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}"
      }),
      { params: Promise.resolve({ id: prepared.purchaseId }) }
    );
    const approved = (await response.json()) as { ok?: boolean };

    expect(response.status).toBe(200);
    expect(approved.ok).toBe(true);

    const state = loadState();
    const purchase = state.purchases.find((item) => item.id === prepared.purchaseId);
    expect(purchase?.status).toBe("receipted");
    expect(purchase?.payment?.txId).toBe("txid_direct_1234567890abcdef");
    expect(purchase?.paymentReceipt).toMatchObject({
      kind: "direct_transfer",
      recipientName: "Alice",
      payTo: "u1recipient0000000000000000000000000000000000000000",
      amountZec: "0.01",
      purpose: "Integration smoke test",
      txId: "txid_direct_1234567890abcdef",
      confirmationStatus: "confirmed",
      confirmations: 1
    });

    expect(fs.existsSync(path.join(home, "state.json"))).toBe(true);
  });

  it("keeps submitted direct transfers pending until get_agentzcash_state sees confirmation", async () => {
    const { confirmationFile } = setupTempAgentHome({ txStatus: "not_found" });
    const prepared = await prepareDirectTransfer({
      recipientName: "Alice",
      amountZec: "0.01",
      address: "u1recipient0000000000000000000000000000000000000000",
      memo: "pending test transfer",
      purpose: "Pending confirmation smoke test",
      evidenceUrls: ["https://example.com/invoice"],
      agentVerificationNotes: "Address and amount copied from the invoice."
    });

    const response = await approvePurchase(
      new NextRequest(`http://localhost/api/purchases/${prepared.purchaseId}/approve`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}"
      }),
      { params: Promise.resolve({ id: prepared.purchaseId }) }
    );
    expect(response.status).toBe(200);

    let purchase = loadState().purchases.find((item) => item.id === prepared.purchaseId);
    expect(purchase?.status).toBe("pending_confirmation");
    expect(purchase?.paymentReceipt).toMatchObject({
      confirmationStatus: "not_found",
      confirmations: 0
    });

    fs.writeFileSync(confirmationFile, "1");
    const refreshed = await getAgentZcashState();
    purchase = refreshed.state.purchases.find((item) => item.id === prepared.purchaseId);

    expect(purchase?.status).toBe("receipted");
    expect(purchase?.paymentReceipt).toMatchObject({
      confirmationStatus: "confirmed",
      confirmations: 1,
      txId: "txid_direct_1234567890abcdef"
    });
    expect(purchase?.paymentReceipt?.confirmedAt).toBeDefined();
  });
});

function setupTempAgentHome({ txStatus }: { txStatus: "1" | "not_found" }): {
  home: string;
  confirmationFile: string;
} {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "agentzcash-loop-"));
  const fakeWallet = path.join(tempDir, "fake-wallet.mjs");
  const confirmationFile = path.join(tempDir, "confirmation.txt");
  fs.writeFileSync(confirmationFile, txStatus);
  fs.writeFileSync(
    fakeWallet,
    [
      "import fs from 'node:fs';",
      "const mode = process.argv[2];",
      "if (mode === 'balance') {",
      "  console.log('1.00000000');",
      "} else if (mode === 'send') {",
      "  console.log('submitted txid_direct_1234567890abcdef');",
      "} else if (mode === 'tx') {",
      "  const status = fs.readFileSync(process.env.AGENTZCASH_FAKE_CONFIRMATION_FILE, 'utf8').trim();",
      "  if (status === 'not_found') {",
      "    process.exit(0);",
      "  }",
      "  console.log(JSON.stringify({ confirmations: Number(status), height: 123 }));",
      "} else {",
      "  console.error(`unknown fake wallet mode: ${mode}`);",
      "  process.exit(1);",
      "}",
      ""
    ].join("\n")
  );

  const node = slashPath(process.execPath);
  const wallet = slashPath(fakeWallet);
  const configPath = path.join(tempDir, "agentzcash.config.yaml");

  fs.writeFileSync(
    configPath,
    [
      "agent:",
      "  name: Test",
      "  walletMode: external-cli",
      "  walletAddress: u1agent0000000000000000000000000000000000000000000",
      `  externalCliCommand: ${JSON.stringify(`"${node}" "${wallet}" send {to} {amount} {memo}`)}`,
      `  externalCliBalanceCommand: ${JSON.stringify(`"${node}" "${wallet}" balance`)}`,
      `  externalCliTxCheckCommand: ${JSON.stringify(`"${node}" "${wallet}" tx {txId}`)}`,
      "",
      "spending:",
      '  perTransactionZec: "0.05"',
      '  dailyZec: "0.15"',
      '  monthlyZec: "1.00"',
      "",
      "approval:",
      "  requireEveryPayment: true",
      "  allowOneTimeOverride: true",
      "",
      "vendors:",
      "  allowUnknownVendors: true",
      "  trusted: []",
      "",
      "privacy:",
      "  showPrivacyLabel: true",
      "",
      "verification:",
      "  mode: external-cli",
      "  minConfirmations: 1",
      "",
      "shippingProfiles: []",
      ""
    ].join("\n")
  );

  process.env.AGENTZCASH_HOME = tempDir;
  process.env.AGENTZCASH_CONFIG = configPath;
  process.env.AGENTZCASH_STATE_PATH = path.join(tempDir, "state.json");
  process.env.AGENTZCASH_FAKE_CONFIRMATION_FILE = confirmationFile;
  return { home: tempDir, confirmationFile };
}

function slashPath(value: string): string {
  return value.replaceAll("\\", "/");
}

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}
