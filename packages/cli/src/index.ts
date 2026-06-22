#!/usr/bin/env node
import { execFile, spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { promisify } from "node:util";
import {
  createWalletAdapter,
  getAgentZcashHome,
  getConfigPath,
  getManagedWalletDir,
  getStatePath,
  loadConfig,
  loadState,
  parseBalanceOutput,
  parseReceiveAddressOutput,
  saveState,
  zatsToZec
} from "@agentzcash/core";

const execFileAsync = promisify(execFile);

interface Flags {
  dryRun: boolean;
  noStart: boolean;
  write: boolean;
  loop: boolean;
  runtime: boolean;
}

interface DoctorCheck {
  label: string;
  ok: boolean;
  detail: string;
  fix?: string;
}

async function main() {
  const [command = "help", subcommand, ...rest] = process.argv.slice(2);

  try {
    switch (command) {
      case "init":
        await init(parseFlags([subcommand, ...rest].filter(Boolean) as string[]));
        break;
      case "start":
        await start();
        break;
      case "doctor":
        await doctor(parseFlags([subcommand, ...rest].filter(Boolean) as string[]));
        break;
      case "install-wallet":
        await installWallet();
        break;
      case "wallet":
        await wallet(subcommand, rest);
        break;
      case "mcp":
        await mcp(subcommand, rest);
        break;
      default:
        printHelp();
        process.exitCode = command === "help" || command === "--help" || command === "-h" ? 0 : 1;
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

function parseFlags(args: string[]): Flags {
  return {
    dryRun: args.includes("--dry-run"),
    noStart: args.includes("--no-start"),
    write: args.includes("--write"),
    loop: args.includes("--loop"),
    runtime: args.includes("--runtime")
  };
}

async function init(flags: Flags) {
  const home = getAgentZcashHome();
  const walletDir = getManagedWalletDir();
  const configPath = getConfigPath();
  const statePath = getStatePath();

  console.log("AgentZcash init");
  console.log(`Home: ${home}`);
  console.log(`Managed wallet: ${walletDir}`);

  if (flags.dryRun) {
    console.log("Dry run: would check Zingo CLI, create one managed wallet if needed, write config/state, and start services.");
    console.log(`Config: ${configPath}`);
    console.log(`State: ${statePath}`);
    return;
  }

  await ensureZingoAvailable();
  fs.mkdirSync(home, { recursive: true });
  fs.mkdirSync(walletDir, { recursive: true });

  const existed = walletExists(walletDir);
  let seed = "";
  if (!existed) {
    console.log("Creating AgentZcash managed wallet...");
    await runZingo(["--data-dir", walletDir, "addresses"], 120_000);
    seed = await readWalletSeed(walletDir);
    console.log("");
    console.log("Save this recovery seed now. AgentZcash does not store the plaintext seed.");
    console.log(seed);
    console.log("");
    await requireExactConfirmation("Type \"I saved this seed\" to continue: ", "I saved this seed");
  } else {
    console.log("Existing AgentZcash wallet found; resuming setup.");
  }

  const address = await readReceiveAddress(walletDir);
  writeConfig(configPath, address);
  const state = loadState();
  state.wallet.address = address;
  state.wallet.backup = {
    ...state.wallet.backup,
    seedConfirmedAt: existed ? state.wallet.backup?.seedConfirmedAt : new Date().toISOString(),
    recoveryShownAt: seed ? new Date().toISOString() : state.wallet.backup?.recoveryShownAt
  };
  saveState(state);

  console.log("");
  console.log("Receive address:");
  console.log(address);
  console.log("");
  console.log("Fund this address from an external wallet or exchange before approving spends.");

  if (!flags.noStart) {
    await start();
  }
}

async function start() {
  console.log("Starting AgentZcash dashboard and MCP server...");
  const repoRoot = findRepoRoot(process.cwd());
  if (!repoRoot) {
    console.log("Start is available from the AgentZcash workspace in this build.");
    console.log("Run the dashboard and MCP server packages directly after publishing them as runtime services.");
    return;
  }

  spawn("npm", ["run", "dev"], {
    cwd: repoRoot,
    stdio: "inherit",
    shell: process.platform === "win32"
  });
  console.log("Dashboard: http://localhost:3000");
  console.log("MCP HTTP: http://localhost:3010");
}

async function doctor(flags: Flags) {
  const checks = flags.runtime ? await collectRuntimeDoctorChecks() : await collectDoctorChecks(flags);

  for (const check of checks) {
    console.log(`${check.ok ? "PASS" : "FAIL"} ${check.label}: ${check.detail}`);
    if (!check.ok && check.fix) {
      console.log(`  Fix: ${check.fix}`);
    }
  }

  if (flags.runtime) {
    printRuntimeSummary(checks);
    if (checks.some((check) => !check.ok)) {
      process.exitCode = 1;
    }
    return;
  }

  if (flags.loop) {
    printLoopSummary(checks);
    if (checks.some((check) => !check.ok)) {
      process.exitCode = 1;
    }
  }
}

async function collectDoctorChecks(flags: Flags): Promise<DoctorCheck[]> {
  const checks: DoctorCheck[] = [];
  const repoRoot = findRepoRoot(process.cwd());

  checks.push({
    label: "Node",
    ok: Number(process.versions.node.split(".")[0] ?? 0) >= 20,
    detail: process.version,
    fix: "Install Node.js 20 or newer."
  });
  checks.push({
    label: "AgentZcash home",
    ok: fs.existsSync(getAgentZcashHome()),
    detail: getAgentZcashHome(),
    fix: "Run: npx agentzcash init"
  });
  checks.push({
    label: "Config",
    ok: fs.existsSync(getConfigPath()),
    detail: getConfigPath(),
    fix: "Run: npx agentzcash init"
  });
  checks.push({
    label: "State",
    ok: fs.existsSync(getStatePath()),
    detail: getStatePath(),
    fix: "Run: npx agentzcash init"
  });
  checks.push({
    label: "Managed wallet",
    ok: walletExists(getManagedWalletDir()),
    detail: getManagedWalletDir(),
    fix: "Run: npx agentzcash init"
  });

  try {
    await ensureZingoAvailable();
    checks.push({ label: "Zingo CLI", ok: true, detail: zingoCommand() });
  } catch (error) {
    checks.push({
      label: "Zingo CLI",
      ok: false,
      detail: oneLineError(error),
      fix: "Install zingo-cli or set AGENTZCASH_ZINGO_CLI to its absolute path."
    });
  }

  let configLoaded = false;
  let walletAddress: string | undefined;
  try {
    const config = loadConfig();
    configLoaded = true;
    walletAddress = config.agent.walletAddress;
    checks.push({
      label: "Wallet address",
      ok: config.agent.walletAddress !== "configure-your-zcash-address",
      detail: config.agent.walletAddress,
      fix: "Run: npx agentzcash init"
    });
    try {
      const adapter = createWalletAdapter(config);
      const balanceZats = await adapter.getBalance();
      checks.push({
        label: flags.loop ? "Spendable balance" : "Balance",
        ok: flags.loop ? balanceZats > 0 : true,
        detail: `${zatsToZec(balanceZats)} ZEC`,
        fix: walletAddress
          ? `Fund this address, then run: npx agentzcash wallet balance\n       ${walletAddress}`
          : "Run: npx agentzcash wallet receive"
      });
    } catch (error) {
      checks.push({
        label: "Balance",
        ok: false,
        detail: oneLineError(error),
        fix: "Make sure zingo-cli is synced and run: npx agentzcash wallet balance"
      });
    }
  } catch (error) {
    checks.push({
      label: "Config load",
      ok: false,
      detail: oneLineError(error),
      fix: "Run: npx agentzcash init"
    });
  }

  if (!flags.loop) {
    return checks;
  }

  checks.push({
    label: "Workspace",
    ok: Boolean(repoRoot),
    detail: repoRoot ?? "No AgentZcash workspace found from current directory.",
    fix: "Run this command from the AgentZcash repo root."
  });

  if (repoRoot) {
    checks.push({
      label: "npm install",
      ok: fs.existsSync(path.join(repoRoot, "node_modules")),
      detail: path.join(repoRoot, "node_modules"),
      fix: "Run: npm install"
    });
    checks.push({
      label: "Codex MCP config",
      ok: fs.existsSync(path.join(repoRoot, ".codex", "config.toml")),
      detail: path.join(repoRoot, ".codex", "config.toml"),
      fix: "Run: npx agentzcash mcp install codex --write"
    });
    checks.push({
      label: "Claude MCP config",
      ok: fs.existsSync(path.join(repoRoot, ".mcp.json")),
      detail: path.join(repoRoot, ".mcp.json"),
      fix: "Run: npx agentzcash mcp install claude --write"
    });
    checks.push(checkPackageScript(repoRoot, "mcp:stdio", "npm --silent run stdio -w @agentzcash/mcp-server"));
    checks.push(checkPackageScript(repoRoot, "test:loop", "vitest run apps/dashboard/src/agent-loop.test.ts"));
    checks.push({
      label: "Core build output",
      ok: fs.existsSync(path.join(repoRoot, "packages", "core", "dist", "index.js")),
      detail: path.join(repoRoot, "packages", "core", "dist", "index.js"),
      fix: "Run: npm run build -w @agentzcash/core"
    });
    checks.push({
      label: "CLI build output",
      ok: fs.existsSync(path.join(repoRoot, "packages", "cli", "dist", "index.js")),
      detail: path.join(repoRoot, "packages", "cli", "dist", "index.js"),
      fix: "Run: npm run build -w agentzcash"
    });
    checks.push({
      label: "MCP build output",
      ok: fs.existsSync(path.join(repoRoot, "apps", "mcp-server", "dist", "tools.js")),
      detail: path.join(repoRoot, "apps", "mcp-server", "dist", "tools.js"),
      fix: "Run: npm run build -w @agentzcash/mcp-server"
    });

    checks.push(await checkMcpToolSurface(repoRoot));
    checks.push(await runMcpPrepareSmoke(repoRoot));
  }

  if (configLoaded) {
    checks.push({
      label: "Human approval invariant",
      ok: true,
      detail: "Agents can prepare a transfer; dashboard approval is still required before wallet submission."
    });
  }

  return checks;
}

async function collectRuntimeDoctorChecks(): Promise<DoctorCheck[]> {
  const checks: DoctorCheck[] = [];
  const repoRoot = findRepoRoot(process.cwd());
  const cliEntry = process.argv[1] ? path.resolve(process.argv[1]) : fileURLToPath(import.meta.url);

  checks.push({
    label: "Node",
    ok: Number(process.versions.node.split(".")[0] ?? 0) >= 20,
    detail: process.version,
    fix: "Install Node.js 20 or newer."
  });
  checks.push({
    label: "Runtime mode",
    ok: true,
    detail: repoRoot ? `repo checkout: ${repoRoot}` : "installed package mode"
  });
  checks.push({
    label: "CLI entry",
    ok: fs.existsSync(cliEntry),
    detail: cliEntry,
    fix: "Run: npm run build -w agentzcash"
  });

  const cliPackagePath = findCliPackageJson(cliEntry, repoRoot);
  checks.push({
    label: "CLI package metadata",
    ok: Boolean(cliPackagePath),
    detail: cliPackagePath ?? "Could not locate agentzcash package.json.",
    fix: "Run from a built AgentZcash checkout or install the agentzcash package."
  });

  if (repoRoot) {
    checks.push({
      label: "npm install",
      ok: fs.existsSync(path.join(repoRoot, "node_modules")),
      detail: path.join(repoRoot, "node_modules"),
      fix: "Run: npm install"
    });
    checks.push(checkPackageScript(repoRoot, "build", "npm run build -w @agentzcash/core && npm run build -w agentzcash && npm run build -w @agentzcash/mcp-server && npm run build -w @agentzcash/dashboard"));
    checks.push({
      label: "Core build output",
      ok: fs.existsSync(path.join(repoRoot, "packages", "core", "dist", "index.js")),
      detail: path.join(repoRoot, "packages", "core", "dist", "index.js"),
      fix: "Run: npm run build -w @agentzcash/core"
    });
    checks.push({
      label: "CLI build output",
      ok: fs.existsSync(path.join(repoRoot, "packages", "cli", "dist", "index.js")),
      detail: path.join(repoRoot, "packages", "cli", "dist", "index.js"),
      fix: "Run: npm run build -w agentzcash"
    });
    checks.push({
      label: "MCP stdio build output",
      ok: fs.existsSync(path.join(repoRoot, "apps", "mcp-server", "dist", "stdio.js")),
      detail: path.join(repoRoot, "apps", "mcp-server", "dist", "stdio.js"),
      fix: "Run: npm run build -w @agentzcash/mcp-server"
    });
    checks.push({
      label: "MCP tools build output",
      ok: fs.existsSync(path.join(repoRoot, "apps", "mcp-server", "dist", "tools.js")),
      detail: path.join(repoRoot, "apps", "mcp-server", "dist", "tools.js"),
      fix: "Run: npm run build -w @agentzcash/mcp-server"
    });
    checks.push({
      label: "Dashboard production build",
      ok: fs.existsSync(path.join(repoRoot, "apps", "dashboard", ".next", "BUILD_ID")),
      detail: path.join(repoRoot, "apps", "dashboard", ".next", "BUILD_ID"),
      fix: "Run: npm run build -w @agentzcash/dashboard"
    });
    checks.push({
      label: "Dashboard start script",
      ok: packageScriptEquals(path.join(repoRoot, "apps", "dashboard", "package.json"), "start", "next start --port 3000"),
      detail: "apps/dashboard package start script",
      fix: "Restore @agentzcash/dashboard start script to: next start --port 3000"
    });
  } else {
    checks.push(await resolveRuntimeModuleCheck("Core runtime module", "@agentzcash/core"));
    checks.push(await resolveRuntimeModuleCheck("MCP stdio runtime module", "@agentzcash/mcp-server/dist/stdio.js"));
    checks.push({
      label: "Dashboard packaged runtime",
      ok: false,
      detail: "Packaged dashboard startup is not implemented yet.",
      fix: "Use repo mode for now: clone, npm install, npm run build, npx agentzcash start"
    });
  }

  checks.push(await checkCliMcpPreview());
  checks.push({
    label: "Start mode",
    ok: Boolean(repoRoot),
    detail: repoRoot
      ? "agentzcash start currently launches repo dev services with npm run dev."
      : "agentzcash start cannot launch packaged services yet.",
    fix: "Production packaged dashboard/MCP startup is still a TODO."
  });

  return checks;
}

function checkPackageScript(repoRoot: string, scriptName: string, expected: string): DoctorCheck {
  const packagePath = path.join(repoRoot, "package.json");
  try {
    const parsed = JSON.parse(fs.readFileSync(packagePath, "utf8")) as { scripts?: Record<string, string> };
    const actual = parsed.scripts?.[scriptName];
    return {
      label: `npm script ${scriptName}`,
      ok: actual === expected,
      detail: actual ?? "missing",
      fix: `Restore ${scriptName} to: ${expected}`
    };
  } catch (error) {
    return {
      label: `npm script ${scriptName}`,
      ok: false,
      detail: oneLineError(error),
      fix: "Run this command from a valid AgentZcash repo checkout."
    };
  }
}

function packageScriptEquals(packagePath: string, scriptName: string, expected: string): boolean {
  try {
    const parsed = JSON.parse(fs.readFileSync(packagePath, "utf8")) as { scripts?: Record<string, string> };
    return parsed.scripts?.[scriptName] === expected;
  } catch {
    return false;
  }
}

function findCliPackageJson(cliEntry: string, repoRoot: string | undefined): string | undefined {
  const candidates = [
    repoRoot ? path.join(repoRoot, "packages", "cli", "package.json") : undefined,
    path.resolve(path.dirname(cliEntry), "..", "package.json"),
    path.resolve(path.dirname(cliEntry), "..", "..", "package.json")
  ].filter((candidate): candidate is string => Boolean(candidate));

  for (const candidate of candidates) {
    if (!fs.existsSync(candidate)) continue;
    try {
      const parsed = JSON.parse(fs.readFileSync(candidate, "utf8")) as { name?: string };
      if (parsed.name === "agentzcash") return candidate;
    } catch {
      // Keep looking.
    }
  }

  return undefined;
}

async function resolveRuntimeModuleCheck(label: string, specifier: string): Promise<DoctorCheck> {
  try {
    const resolved = import.meta.resolve(specifier);
    return { label, ok: true, detail: resolved };
  } catch (error) {
    return {
      label,
      ok: false,
      detail: oneLineError(error),
      fix: `Install package dependency that provides ${specifier}.`
    };
  }
}

async function checkCliMcpPreview(): Promise<DoctorCheck> {
  const cliEntry = process.argv[1] ? path.resolve(process.argv[1]) : fileURLToPath(import.meta.url);
  try {
    const { stdout } = await execFileAsync(process.execPath, [cliEntry, "mcp", "install", "codex"], {
      timeout: 15_000
    });
    const expected = "codex mcp add agentzcash -- npx agentzcash mcp stdio";
    return {
      label: "CLI MCP install preview",
      ok: stdout.includes(expected),
      detail: stdout.trim().replace(/\s+/g, " "),
      fix: `Expected preview to include: ${expected}`
    };
  } catch (error) {
    return {
      label: "CLI MCP install preview",
      ok: false,
      detail: oneLineError(error),
      fix: "Run: npm run build -w agentzcash"
    };
  }
}

async function checkMcpToolSurface(repoRoot: string): Promise<DoctorCheck> {
  try {
    const toolsModule = await importMcpTools(repoRoot);
    const names = (toolsModule.toolDefinitions ?? []).map((tool) => tool.name);
    const missing = ["prepare_direct_transfer", "get_agentzcash_state"].filter((name) => !names.includes(name));
    const autonomousPaymentTools = names.filter((name) => /\b(approve|reject|submit|send|pay)\b/i.test(name));

    return {
      label: "MCP tool surface",
      ok: missing.length === 0 && autonomousPaymentTools.length === 0,
      detail:
        missing.length > 0
          ? `Missing: ${missing.join(", ")}`
          : `Tools: ${names.join(", ")}`,
      fix:
        autonomousPaymentTools.length > 0
          ? `Remove autonomous payment tools from MCP: ${autonomousPaymentTools.join(", ")}`
          : "Run: npm run build -w @agentzcash/mcp-server"
    };
  } catch (error) {
    return {
      label: "MCP tool surface",
      ok: false,
      detail: oneLineError(error),
      fix: "Run: npm run build -w @agentzcash/mcp-server"
    };
  }
}

async function runMcpPrepareSmoke(repoRoot: string): Promise<DoctorCheck> {
  const originalHome = process.env.AGENTZCASH_HOME;
  const originalConfig = process.env.AGENTZCASH_CONFIG;
  const originalStatePath = process.env.AGENTZCASH_STATE_PATH;
  const tempDir = fs.mkdtempSync(path.join(osTmpDir(), "agentzcash-doctor-"));

  try {
    const configPath = path.join(tempDir, "agentzcash.config.yaml");
    fs.writeFileSync(
      configPath,
      [
        "agent:",
        "  name: Doctor",
        "  walletMode: external-cli",
        "  walletAddress: u1doctor000000000000000000000000000000000000000000",
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

    const toolsModule = await importMcpTools(repoRoot);
    if (!toolsModule.prepareDirectTransfer) {
      throw new Error("prepareDirectTransfer export is missing.");
    }

    const result = await toolsModule.prepareDirectTransfer({
      recipientName: "Doctor",
      amountZec: "0.01",
      address: "u1recipient0000000000000000000000000000000000000000",
      memo: "doctor smoke test",
      purpose: "Readiness smoke test",
      evidenceUrls: ["https://example.com/invoice"],
      agentVerificationNotes: "Isolated temp-state readiness check."
    });

    return {
      label: "MCP prepare smoke",
      ok: result.status === "awaiting_approval" && result.approvalUrl.includes("http://localhost:3000/?purchase="),
      detail: `${result.status} ${result.approvalUrl}`,
      fix: "Run: npm run test:loop"
    };
  } catch (error) {
    return {
      label: "MCP prepare smoke",
      ok: false,
      detail: oneLineError(error),
      fix: "Run: npm run build -w @agentzcash/mcp-server, then npm run test:loop"
    };
  } finally {
    restoreEnv("AGENTZCASH_HOME", originalHome);
    restoreEnv("AGENTZCASH_CONFIG", originalConfig);
    restoreEnv("AGENTZCASH_STATE_PATH", originalStatePath);
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

async function importMcpTools(repoRoot: string): Promise<{
  toolDefinitions?: Array<{ name: string }>;
  prepareDirectTransfer?: (args: Record<string, unknown>) => Promise<{
    purchaseId: string;
    status: string;
    approvalUrl: string;
  }>;
}> {
  const toolsPath = path.join(repoRoot, "apps", "mcp-server", "dist", "tools.js");
  return await import(pathToFileURL(toolsPath).href) as {
    toolDefinitions?: Array<{ name: string }>;
    prepareDirectTransfer?: (args: Record<string, unknown>) => Promise<{
      purchaseId: string;
      status: string;
      approvalUrl: string;
    }>;
  };
}

function printLoopSummary(checks: DoctorCheck[]): void {
  if (!checks.some((check) => !check.ok)) {
    console.log("");
    console.log("READY Shielded agentic transfer loop is ready.");
    console.log("Next: start Codex or Claude Code from this repo and ask it to prepare a shielded ZEC transfer.");
    console.log("The agent can prepare the spend request; you still approve or reject it in the dashboard.");
    return;
  }

  const balance = checks.find((check) => check.label === "Spendable balance");
  console.log("");
  console.log("NOT READY Fix the failed checks above, then run:");
  console.log("  npx agentzcash doctor --loop");
  if (balance && !balance.ok) {
    console.log("");
    console.log("Funding step:");
    console.log("  npx agentzcash wallet receive");
    console.log("  npx agentzcash wallet balance");
  }
}

function printRuntimeSummary(checks: DoctorCheck[]): void {
  if (!checks.some((check) => !check.ok)) {
    console.log("");
    console.log("READY Runtime shape is ready for the current repo-mode startup path.");
    console.log("Note: agentzcash start still uses repo dev services; packaged production startup is not implemented yet.");
    return;
  }

  console.log("");
  console.log("RUNTIME NOT READY Fix the failed checks above, then run:");
  console.log("  npx agentzcash doctor --runtime");
}

function oneLineError(error: unknown): string {
  return error instanceof Error ? error.message.replace(/\s+/g, " ").trim() : String(error);
}

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}

function osTmpDir(): string {
  return process.env.TEMP ?? process.env.TMP ?? process.cwd();
}

async function wallet(subcommand: string | undefined, rest: string[]) {
  switch (subcommand) {
    case "doctor":
      await walletDoctor();
      return;
    case "receive":
      console.log(await readReceiveAddress(getManagedWalletDir()));
      return;
    case "balance": {
      const { stdout } = await runZingo(["--data-dir", getManagedWalletDir(), "--waitsync", "balance"], 45_000);
      console.log(`${zatsToZec(parseBalanceOutput(stdout))} ZEC`);
      return;
    }
    case "backup":
      await requireExactConfirmation("Type \"SHOW SEED\" to display wallet recovery info: ", "SHOW SEED");
      console.log(await readWalletSeed(getManagedWalletDir()));
      return;
    default:
      console.log("Usage: agentzcash wallet doctor|receive|balance|backup");
      void rest;
  }
}

async function installWallet() {
  console.log("AgentZcash wallet dependency: Zingo CLI");
  console.log("");
  const found = await findZingoCommand();
  if (found) {
    console.log(`Found zingo-cli: ${found}`);
    console.log("You can continue with:");
    console.log("  npx agentzcash init");
    return;
  }

  console.log("No zingo-cli binary was found on PATH or AGENTZCASH_ZINGO_CLI.");
  console.log("");
  printZingoInstallGuidance();
}

async function walletDoctor() {
  const checks: DoctorCheck[] = [];
  const found = await findZingoCommand();

  checks.push({
    label: "Zingo CLI command",
    ok: Boolean(found),
    detail: found ?? zingoCommand(),
    fix: "Run: npx agentzcash install-wallet"
  });

  if (found) {
    try {
      const { stdout, stderr } = await execFileAsync(found, ["--help"], { timeout: 15_000 });
      const firstLine = (stdout || stderr).trim().split(/\r?\n/)[0] ?? "zingo-cli responded";
      checks.push({ label: "Zingo CLI executable", ok: true, detail: firstLine });
    } catch (error) {
      checks.push({
        label: "Zingo CLI executable",
        ok: false,
        detail: oneLineError(error),
        fix: "Set AGENTZCASH_ZINGO_CLI to a working zingo-cli binary."
      });
    }
  }

  checks.push({
    label: "AgentZcash home",
    ok: fs.existsSync(getAgentZcashHome()),
    detail: getAgentZcashHome(),
    fix: "Run: npx agentzcash init"
  });
  checks.push({
    label: "Managed wallet directory",
    ok: fs.existsSync(getManagedWalletDir()),
    detail: getManagedWalletDir(),
    fix: "Run: npx agentzcash init"
  });
  checks.push({
    label: "Managed wallet file",
    ok: walletExists(getManagedWalletDir()),
    detail: path.join(getManagedWalletDir(), "zingo-wallet.dat"),
    fix: "Run: npx agentzcash init"
  });

  try {
    const config = loadConfig();
    checks.push({
      label: "AgentZcash config",
      ok: true,
      detail: getConfigPath()
    });
    checks.push({
      label: "Configured receive address",
      ok: config.agent.walletAddress !== "configure-your-zcash-address",
      detail: config.agent.walletAddress,
      fix: "Run: npx agentzcash init"
    });

    try {
      const adapter = createWalletAdapter(config);
      const balanceZats = await adapter.getBalance();
      checks.push({
        label: "Spendable balance",
        ok: balanceZats > 0,
        detail: `${zatsToZec(balanceZats)} ZEC`,
        fix: `Fund this address, then run: npx agentzcash wallet balance\n       ${config.agent.walletAddress}`
      });
    } catch (error) {
      checks.push({
        label: "Spendable balance",
        ok: false,
        detail: oneLineError(error),
        fix: "Make sure zingo-cli is synced and run: npx agentzcash wallet balance"
      });
    }
  } catch (error) {
    checks.push({
      label: "AgentZcash config",
      ok: false,
      detail: oneLineError(error),
      fix: "Run: npx agentzcash init"
    });
  }

  for (const check of checks) {
    console.log(`${check.ok ? "PASS" : "FAIL"} ${check.label}: ${check.detail}`);
    if (!check.ok && check.fix) {
      console.log(`  Fix: ${check.fix}`);
    }
  }

  if (checks.some((check) => !check.ok)) {
    console.log("");
    console.log("Wallet is not ready yet.");
    console.log("For setup guidance, run:");
    console.log("  npx agentzcash install-wallet");
    process.exitCode = 1;
  } else {
    console.log("");
    console.log("Wallet dependency and managed wallet are ready.");
  }
}

async function mcp(subcommand: string | undefined, rest: string[]) {
  if (subcommand === "stdio") {
    try {
      const mcpStdioModule = "@agentzcash/mcp-server/dist/stdio.js";
      await import(mcpStdioModule);
    } catch {
      await runWorkspaceScript("@agentzcash/mcp-server", "stdio");
    }
    return;
  }
  if (subcommand !== "install") {
    console.log("Usage: agentzcash mcp stdio | install codex|claude [--write]");
    return;
  }
  const target = rest.find((arg) => arg === "codex" || arg === "claude");
  const flags = parseFlags(rest);
  if (!target) {
    console.log("Usage: agentzcash mcp install codex|claude [--write]");
    return;
  }

  if (target === "codex") {
    console.log("Codex MCP setup:");
    console.log("codex mcp add agentzcash -- npx agentzcash mcp stdio");
    if (flags.write) {
      const configPath = writeCodexProjectConfig();
      console.log(`Wrote ${configPath}`);
    }
    return;
  }

  console.log("Claude Code MCP setup:");
  console.log("claude mcp add --scope project --transport stdio agentzcash -- npx agentzcash mcp stdio");
  const preview = claudeProjectMcpConfig();
  console.log("Project .mcp.json preview:");
  console.log(JSON.stringify(preview, null, 2));
  if (flags.write) {
    const configPath = writeClaudeProjectConfig();
    console.log(`Wrote ${configPath}`);
  }
}

async function runWorkspaceScript(workspace: string, script: string): Promise<void> {
  const repoRoot = findRepoRoot(process.cwd());
  if (!repoRoot) {
    throw new Error(`Cannot locate AgentZcash workspace to run ${workspace}:${script}.`);
  }
  await new Promise<void>((resolve, reject) => {
    const child = spawn("npm", ["run", script, "-w", workspace], {
      cwd: repoRoot,
      stdio: "inherit",
      shell: process.platform === "win32"
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${workspace}:${script} exited with code ${code ?? "unknown"}.`));
    });
  });
}

async function ensureZingoAvailable() {
  try {
    await execFileAsync(zingoCommand(), ["--help"], { timeout: 15_000 });
  } catch {
    throw new Error(
      [
        `Zingo CLI binary not found or not executable: ${zingoCommand()}`,
        "Install/build zingo-cli, then set AGENTZCASH_ZINGO_CLI to its absolute path if it is not on PATH.",
        "AgentZcash guidance:",
        "  npx agentzcash install-wallet",
        "Build from source:",
        "  git clone https://github.com/zingolabs/zingolib.git",
        "  cd zingolib",
        "  cargo build --release --package zingo-cli"
      ].join("\n")
    );
  }
}

function zingoCommand(): string {
  return process.env.AGENTZCASH_ZINGO_CLI ?? "zingo-cli";
}

async function findZingoCommand(): Promise<string | undefined> {
  if (process.env.AGENTZCASH_ZINGO_CLI) {
    return process.env.AGENTZCASH_ZINGO_CLI;
  }

  const lookupCommand = process.platform === "win32" ? "where.exe" : "which";
  try {
    const { stdout } = await execFileAsync(lookupCommand, ["zingo-cli"], { timeout: 10_000 });
    return stdout.trim().split(/\r?\n/).find(Boolean);
  } catch {
    return undefined;
  }
}

function printZingoInstallGuidance(): void {
  console.log("Build Zingo CLI from source:");
  console.log("");
  console.log("  git clone https://github.com/zingolabs/zingolib.git");
  console.log("  cd zingolib");
  console.log("  cargo build --release --package zingo-cli");
  console.log("");

  if (process.platform === "win32") {
    console.log("Then point AgentZcash at the built binary in PowerShell:");
    console.log("");
    console.log('  $env:AGENTZCASH_ZINGO_CLI="C:\\path\\to\\zingolib\\target\\release\\zingo-cli.exe"');
    console.log("  npx agentzcash wallet doctor");
    console.log("  npx agentzcash init");
    console.log("");
    console.log("To persist the setting for future PowerShell windows:");
    console.log("");
    console.log('  setx AGENTZCASH_ZINGO_CLI "C:\\path\\to\\zingolib\\target\\release\\zingo-cli.exe"');
    return;
  }

  console.log("Then point AgentZcash at the built binary:");
  console.log("");
  console.log("  export AGENTZCASH_ZINGO_CLI=/path/to/zingolib/target/release/zingo-cli");
  console.log("  npx agentzcash wallet doctor");
  console.log("  npx agentzcash init");
  console.log("");
  console.log("To make it available on PATH instead:");
  console.log("");
  console.log("  sudo install -m 0755 target/release/zingo-cli /usr/local/bin/zingo-cli");
}

async function readWalletSeed(walletDir: string): Promise<string> {
  const { stdout } = await runZingo(["--data-dir", walletDir, "seed"], 30_000);
  const seed = stdout.trim();
  if (seed.split(/\s+/).length < 20) {
    throw new Error("Zingo CLI did not return a recovery seed. Setup stopped before marking seed backup complete.");
  }
  return seed;
}

async function readReceiveAddress(walletDir: string): Promise<string> {
  const { stdout } = await runZingo(["--data-dir", walletDir, "addresses"], 30_000);
  return parseReceiveAddressOutput(stdout);
}

async function runZingo(args: string[], timeout: number) {
  return execFileAsync(zingoCommand(), args, { timeout });
}

function walletExists(walletDir: string): boolean {
  return fs.existsSync(path.join(walletDir, "zingo-wallet.dat"));
}

function writeConfig(configPath: string, address: string) {
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(
    configPath,
    [
      "agent:",
      "  name: AgentZcash",
      "  walletMode: external-cli",
      `  walletAddress: ${address}`,
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
    ].join("\n")
  );
}

function projectRoot(): string {
  return findRepoRoot(process.cwd()) ?? process.cwd();
}

function claudeProjectMcpConfig() {
  return {
    mcpServers: {
      agentzcash: {
        type: "stdio",
        command: "npx",
        args: ["agentzcash", "mcp", "stdio"],
        timeout: 120_000
      }
    }
  };
}

function writeClaudeProjectConfig(): string {
  const root = projectRoot();
  const file = path.join(root, ".mcp.json");
  const existing = fs.existsSync(file)
    ? JSON.parse(fs.readFileSync(file, "utf8")) as { mcpServers?: Record<string, unknown> }
    : {};
  const next = {
    ...existing,
    mcpServers: {
      ...(existing.mcpServers ?? {}),
      ...claudeProjectMcpConfig().mcpServers
    }
  };
  fs.writeFileSync(file, `${JSON.stringify(next, null, 2)}\n`);
  return file;
}

function writeCodexProjectConfig(): string {
  const root = projectRoot();
  const dir = path.join(root, ".codex");
  const file = path.join(dir, "config.toml");
  fs.mkdirSync(dir, { recursive: true });

  const block = [
    "[mcp_servers.agentzcash]",
    'command = "npx"',
    'args = ["agentzcash", "mcp", "stdio"]',
    "startup_timeout_sec = 20",
    "tool_timeout_sec = 120"
  ].join("\n");
  const existing = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
  const next = upsertTomlTable(existing, "mcp_servers.agentzcash", block);
  fs.writeFileSync(file, `${next.trim()}\n`);
  return file;
}

function upsertTomlTable(existing: string, tableName: string, replacement: string): string {
  const lines = existing.split(/\r?\n/);
  const header = `[${tableName}]`;
  const start = lines.findIndex((line) => line.trim() === header);
  if (start === -1) {
    return existing.trim() ? `${existing.trim()}\n\n${replacement}` : replacement;
  }

  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (/^\s*\[.+\]\s*$/.test(lines[i] ?? "")) {
      end = i;
      break;
    }
  }

  return [...lines.slice(0, start), ...replacement.split("\n"), ...lines.slice(end)].join("\n").trim();
}

async function requireExactConfirmation(prompt: string, expected: string) {
  const rl = createInterface({ input, output });
  try {
    const answer = await rl.question(prompt);
    if (answer !== expected) {
      throw new Error("Confirmation did not match; no changes were completed.");
    }
  } finally {
    rl.close();
  }
}

function findRepoRoot(start: string): string | undefined {
  let current = start;
  while (true) {
    const packagePath = path.join(current, "package.json");
    if (fs.existsSync(packagePath)) {
      const parsed = JSON.parse(fs.readFileSync(packagePath, "utf8")) as { workspaces?: string[] };
      if (parsed.workspaces?.includes("apps/*") && parsed.workspaces?.includes("packages/*")) {
        return current;
      }
    }
    const parent = path.dirname(current);
    if (parent === current) return undefined;
    current = parent;
  }
}

function printHelp() {
  console.log(`AgentZcash

Usage:
  agentzcash init [--dry-run] [--no-start]
  agentzcash start
  agentzcash doctor [--loop|--runtime]
  agentzcash install-wallet
  agentzcash wallet doctor
  agentzcash wallet receive
  agentzcash wallet balance
  agentzcash wallet backup
  agentzcash mcp stdio
  agentzcash mcp install codex|claude [--write]
`);
}

await main();
