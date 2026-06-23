import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const root = process.cwd();
const artifactDir = path.join(root, "release-artifacts", "npm");
const manifestPath = path.join(artifactDir, "agentzcash-release-manifest.json");
const npmCommand = process.env.npm_execpath
  ? { command: process.execPath, baseArgs: [process.env.npm_execpath] }
  : { command: process.platform === "win32" ? "npm.cmd" : "npm", baseArgs: [] };
const expectedPackages = [
  "@agentzcash/core",
  "@agentzcash/mcp-server",
  "@agentzcash/dashboard",
  "agentzcash"
];

if (!fs.existsSync(manifestPath)) {
  throw new Error(`Missing release manifest: ${path.relative(root, manifestPath)}. Run npm run release:pack first.`);
}

const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
const packages = new Map(manifest.packages?.map((entry) => [entry.name, entry.tarball]) ?? []);
const tarballs = expectedPackages.map((name) => {
  const tarball = packages.get(name);
  if (!tarball) {
    throw new Error(`Release manifest is missing ${name}.`);
  }
  const fullPath = path.join(artifactDir, tarball);
  if (!fs.existsSync(fullPath)) {
    throw new Error(`Release tarball is missing: ${path.relative(root, fullPath)}`);
  }
  return fullPath;
});

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "agentzcash-packed-"));
const projectRoot = path.join(tempRoot, "project");
const home = path.join(tempRoot, "home");
const configPath = path.join(home, "agentzcash.config.yaml");
const statePath = path.join(home, "state.json");
const cliEntry = path.join(projectRoot, "node_modules", "agentzcash", "dist", "index.js");
const smokeModule = path.join(projectRoot, "smoke.mjs");

try {
  fs.mkdirSync(projectRoot, { recursive: true });
  fs.mkdirSync(home, { recursive: true });
  fs.writeFileSync(path.join(projectRoot, "package.json"), `${JSON.stringify({ private: true, type: "module" }, null, 2)}\n`);
  fs.writeFileSync(configPath, smokeConfig());

  run(npmCommand.command, [...npmCommand.baseArgs, "install", "--omit=dev", ...tarballs], projectRoot);
  run(process.execPath, [cliEntry, "doctor", "--runtime"], projectRoot);
  run(process.execPath, [cliEntry, "mcp", "install", "codex", "--write"], projectRoot);
  run(process.execPath, [cliEntry, "mcp", "install", "claude", "--write"], projectRoot);

  assertFileContains(path.join(projectRoot, "AGENTS.md"), ["AgentZcash Payment Safety", "prepare_direct_transfer"]);
  assertFileContains(path.join(projectRoot, "CLAUDE.md"), ["AgentZcash Payment Safety", "get_agentzcash_state"]);
  assertFileContains(path.join(projectRoot, ".codex", "config.toml"), ["mcp_servers.agentzcash", "agentzcash"]);
  assertFileContains(path.join(projectRoot, ".mcp.json"), ["agentzcash", "mcp", "stdio"]);

  fs.writeFileSync(smokeModule, directTransferSmokeModule());
  run(process.execPath, [smokeModule], projectRoot);

  console.log("Packed install smoke test passed.");
} finally {
  fs.rmSync(tempRoot, { recursive: true, force: true });
}

function run(command, args, cwd) {
  execFileSync(command, args, {
    cwd,
    env: {
      ...process.env,
      AGENTZCASH_HOME: home,
      AGENTZCASH_CONFIG: configPath,
      AGENTZCASH_STATE_PATH: statePath,
      NEXT_TELEMETRY_DISABLED: "1"
    },
    stdio: "inherit"
  });
}

function assertFileContains(file, expected) {
  if (!fs.existsSync(file)) {
    throw new Error(`Expected file was not written: ${file}`);
  }
  const contents = fs.readFileSync(file, "utf8");
  const missing = expected.filter((text) => !contents.includes(text));
  if (missing.length) {
    throw new Error(`${file} is missing expected text: ${missing.join(", ")}`);
  }
}

function smokeConfig() {
  return [
    "agent:",
    "  name: Release Smoke",
    "  walletMode: external-cli",
    "  walletAddress: u1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq",
    "  walletPreset: zingo-cli",
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
  ].join("\n");
}

function directTransferSmokeModule() {
  return `
import fs from "node:fs";
import path from "node:path";
import { prepareDirectTransfer, toolDefinitions } from "@agentzcash/mcp-server/dist/tools.js";

const toolNames = toolDefinitions.map((tool) => tool.name);
for (const name of ["prepare_direct_transfer", "get_agentzcash_state"]) {
  if (!toolNames.includes(name)) {
    throw new Error(\`Missing MCP tool: \${name}\`);
  }
}

const result = await prepareDirectTransfer({
  recipientName: "Smoke Recipient",
  amountZec: "0.001",
  address: "u1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq",
  memo: "release smoke",
  purpose: "Release smoke test",
  evidenceUrls: ["https://example.com/release-smoke"],
  agentVerificationNotes: "Release smoke fixture."
});

if (result.status !== "awaiting_approval") {
  throw new Error(\`Expected awaiting_approval, got \${result.status}\`);
}
if (!result.approvalUrl.includes("purchase=") || !result.approvalUrl.includes("approvalToken=")) {
  throw new Error(\`Approval URL is incomplete: \${result.approvalUrl}\`);
}

console.log("Direct transfer prepare smoke passed.");

const fakeWallet = path.join(process.cwd(), "fake-wallet.mjs");
const sendCountFile = path.join(process.cwd(), "send-count.txt");
fs.writeFileSync(sendCountFile, "0");
fs.writeFileSync(fakeWallet, [
  "import fs from 'node:fs';",
  "const mode = process.argv[2];",
  "if (mode === 'balance') {",
  "  console.log('1.00000000');",
  "} else if (mode === 'send') {",
  "  const countFile = process.env.AGENTZCASH_FAKE_SEND_COUNT_FILE;",
  "  const count = Number(fs.readFileSync(countFile, 'utf8').trim());",
  "  fs.writeFileSync(countFile, String(count + 1));",
  "  console.log('submitted txid_release_smoke_1234567890abcdef');",
  "} else if (mode === 'tx') {",
  "  console.log(JSON.stringify({ confirmations: 1, height: 123 }));",
  "} else {",
  "  process.exit(1);",
  "}",
  ""
].join("\\n"));

process.env.AGENTZCASH_FAKE_SEND_COUNT_FILE = sendCountFile;
fs.writeFileSync(process.env.AGENTZCASH_STATE_PATH, JSON.stringify({ purchases: [], activity: [], vendorOrders: [] }, null, 2));
fs.writeFileSync(process.env.AGENTZCASH_CONFIG, [
  "agent:",
  "  name: Release Smoke",
  "  walletMode: external-cli",
  "  walletAddress: u1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq",
  \`  externalCliCommand: \${JSON.stringify(\`\${JSON.stringify(process.execPath)} "\${fakeWallet.replaceAll("\\\\", "/")}" send {to} {amount} {memo}\`)}\`,
  \`  externalCliBalanceCommand: \${JSON.stringify(\`\${JSON.stringify(process.execPath)} "\${fakeWallet.replaceAll("\\\\", "/")}" balance\`)}\`,
  \`  externalCliTxCheckCommand: \${JSON.stringify(\`\${JSON.stringify(process.execPath)} "\${fakeWallet.replaceAll("\\\\", "/")}" tx {txId}\`)}\`,
  "",
  "spending:",
  "  perTransactionZec: \\"0.05\\"",
  "  dailyZec: \\"0.15\\"",
  "  monthlyZec: \\"1.00\\"",
  "",
  "approval:",
  "  requireEveryPayment: false",
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
].join("\\n"));

const autoResult = await prepareDirectTransfer({
  recipientName: "Smoke Recipient",
  amountZec: "0.001",
  address: "u1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq",
  memo: "release auto smoke",
  purpose: "Release autonomous smoke test",
  evidenceUrls: ["https://example.com/release-smoke"],
  agentVerificationNotes: "Release smoke fixture."
});

if (autoResult.status !== "receipted") {
  throw new Error(\`Expected receipted autonomous transfer, got \${autoResult.status}\`);
}
if (autoResult.approvalUrl !== undefined) {
  throw new Error(\`Autonomous transfer unexpectedly returned approval URL: \${autoResult.approvalUrl}\`);
}
if (fs.readFileSync(sendCountFile, "utf8") !== "1") {
  throw new Error("Autonomous transfer did not send exactly once.");
}

console.log("Autonomous direct transfer smoke passed.");
`;
}
