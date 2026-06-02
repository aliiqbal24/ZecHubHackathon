import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  createAgentWalletAdapter,
  ensureConfig,
  getConfigPath,
  getSetupStatus,
  getStatePath,
  getUserZecGuardHome,
  getZecGuardHome,
  loadConfig,
  loadState
} from "../packages/core/src/index.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const packageRoot = path.resolve(__dirname, "..");

type CheckStatus = "ok" | "warn" | "fail";

interface DoctorCheck {
  name: string;
  status: CheckStatus;
  detail: string;
}

async function main() {
  const [command = "help"] = process.argv.slice(2);

  if (command === "help" || command === "--help" || command === "-h") {
    printHelp();
    return;
  }

  configurePortableRuntime();

  switch (command) {
    case "init":
      await initCommand();
      return;
    case "doctor":
      await doctorCommand();
      return;
    case "dashboard":
      await dashboardCommand();
      return;
    case "mcp":
      await mcpCommand();
      return;
    default:
      process.stderr.write(`Unknown command: ${command}\n\n`);
      printHelp();
      process.exitCode = 1;
  }
}

function printHelp() {
  process.stdout.write(
    [
      "ZecGuard",
      "",
      "Commands:",
      "  zecguard mcp        Start MCP stdio and the local dashboard",
      "  zecguard dashboard  Start only the local dashboard",
      "  zecguard doctor     Check package, runtime, and wallet setup",
      "  zecguard init       Create the default user config/state",
      "",
      "Normal MCP command:",
      "  npx -y @zechub/zecguard mcp",
      ""
    ].join("\n")
  );
}

function configurePortableRuntime() {
  const home = process.env.ZECGUARD_HOME ?? getUserZecGuardHome();
  process.env.ZECGUARD_HOME = home;
  process.env.ZECGUARD_CONFIG ??= path.join(home, "config.yaml");
  process.env.ZECGUARD_STATE_PATH ??= path.join(home, "state.json");
}

async function initCommand() {
  const config = ensureConfig();
  loadState();
  process.stdout.write(
    [
      "ZecGuard user runtime initialized.",
      `Home: ${getZecGuardHome()}`,
      `Config: ${getConfigPath()}`,
      `State: ${getStatePath()}`,
      `Wallet backend: ${config.agentWallet.backend}`,
      ""
    ].join("\n")
  );
}

async function doctorCommand() {
  ensureConfig();
  const state = loadState();
  const config = loadConfig();
  const checks: DoctorCheck[] = [];
  const nodeMajor = Number(process.versions.node.split(".")[0] ?? 0);
  checks.push({
    name: "Node.js",
    status: nodeMajor >= 20 ? "ok" : "fail",
    detail: `${process.version}${nodeMajor >= 20 ? "" : " (Node 20+ required)"}`
  });
  checks.push({
    name: "Package root",
    status: fs.existsSync(packageRoot) ? "ok" : "fail",
    detail: packageRoot
  });
  checks.push({
    name: "MCP stdio bundle",
    status: fs.existsSync(mcpBundlePath()) ? "ok" : "fail",
    detail: mcpBundlePath()
  });
  checks.push({
    name: "Dashboard app",
    status: fs.existsSync(dashboardDir()) ? "ok" : "fail",
    detail: dashboardDir()
  });
  checks.push({
    name: "Dashboard build",
    status: dashboardBuildAvailable() ? "ok" : "warn",
    detail: dashboardBuildAvailable()
      ? "Production build is present."
      : "No .next/BUILD_ID found; source installs will use next dev."
  });
  checks.push({
    name: "Config path",
    status: fs.existsSync(getConfigPath()) ? "ok" : "fail",
    detail: getConfigPath()
  });
  checks.push({
    name: "State path",
    status: fs.existsSync(getStatePath()) ? "ok" : "fail",
    detail: getStatePath()
  });
  checks.push({
    name: "Wallet data path",
    status: fs.existsSync(path.dirname(state.agentWallet.dataDir)) || fs.existsSync(state.agentWallet.dataDir) ? "ok" : "warn",
    detail: state.agentWallet.dataDir
  });

  const requestedPort = Number(process.env.ZECGUARD_DASHBOARD_PORT ?? 3000);
  const port = await findAvailablePort(requestedPort);
  process.env.ZECGUARD_DASHBOARD_PORT = String(port);
  process.env.ZECGUARD_DASHBOARD_URL = `http://127.0.0.1:${port}`;
  checks.push({
    name: "Dashboard port",
    status: port === requestedPort ? "ok" : "warn",
    detail: port === requestedPort
      ? `127.0.0.1:${requestedPort} available`
      : `${requestedPort} unavailable; would use 127.0.0.1:${port}`
  });

  if (config.agentWallet.backend === "zingo-cli") {
    const availability = await createAgentWalletAdapter(config).checkAvailability();
    checks.push({
      name: "Zingo CLI",
      status: availability.available ? "ok" : "warn",
      detail: availability.available ? `${config.agentWallet.zingoCliPath} is available.` : (availability.detail ?? "Zingo CLI is not available.")
    });
  } else {
    checks.push({
      name: "Zingo CLI",
      status: "ok",
      detail: "Mock wallet backend does not require Zingo CLI."
    });
  }

  const setup = getSetupStatus(config, state);
  checks.push({
    name: "Setup wizard",
    status: setup.setupRequired ? "warn" : "ok",
    detail: setup.setupRequired ? `Missing: ${setup.blockers.join(", ")}` : "Real-wallet setup is complete."
  });

  for (const check of checks) {
    process.stdout.write(`${check.status.toUpperCase().padEnd(4)} ${check.name}: ${check.detail}\n`);
  }
  process.stdout.write(`\nDashboard: ${setup.dashboardUrl}\n`);
  process.stdout.write(`Config: ${getConfigPath()}\n`);

  if (checks.some((check) => check.status === "fail")) {
    process.exitCode = 1;
  }
}

async function dashboardCommand() {
  ensureConfig();
  loadState();
  const dashboard = await startDashboard();
  process.stderr.write(`ZecGuard dashboard: ${process.env.ZECGUARD_DASHBOARD_URL}\n`);
  dashboard.on("exit", (code) => {
    process.exit(code ?? 0);
  });
}

async function mcpCommand() {
  ensureConfig();
  loadState();
  const dashboard = await startDashboard();
  process.stderr.write(`ZecGuard dashboard: ${process.env.ZECGUARD_DASHBOARD_URL}\n`);
  registerShutdown(dashboard);
  await import(pathToFileURL(mcpBundlePath()).href);
}

async function startDashboard(): Promise<ChildProcessWithoutNullStreams> {
  const port = await findAvailablePort(Number(process.env.ZECGUARD_DASHBOARD_PORT ?? 3000));
  process.env.ZECGUARD_DASHBOARD_PORT = String(port);
  process.env.ZECGUARD_DASHBOARD_URL = `http://127.0.0.1:${port}`;

  const nextBin = path.join(packageRoot, "node_modules", "next", "dist", "bin", "next");
  if (!fs.existsSync(nextBin)) {
    throw new Error(`Missing Next.js runtime at ${nextBin}. Reinstall the package and run zecguard doctor.`);
  }

  const args = [nextBin, dashboardBuildAvailable() ? "start" : "dev", "--hostname", "127.0.0.1", "--port", String(port)];
  const child = spawn(process.execPath, args, {
    cwd: dashboardDir(),
    env: {
      ...process.env,
      PORT: String(port)
    },
    stdio: ["ignore", "pipe", "pipe"]
  });

  child.stdout.on("data", (chunk) => process.stderr.write(chunk));
  child.stderr.on("data", (chunk) => process.stderr.write(chunk));
  await waitForDashboard(port, child);
  return child;
}

function dashboardDir(): string {
  return path.join(packageRoot, "apps", "dashboard");
}

function dashboardBuildAvailable(): boolean {
  return fs.existsSync(path.join(dashboardDir(), ".next", "BUILD_ID"));
}

function mcpBundlePath(): string {
  return path.join(packageRoot, "dist", "mcp-stdio.js");
}

async function findAvailablePort(start: number): Promise<number> {
  for (let port = start; port < start + 50; port += 1) {
    if (await portAvailable(port)) {
      return port;
    }
  }
  throw new Error(`No dashboard port available from ${start} to ${start + 49}.`);
}

function portAvailable(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once("error", () => resolve(false));
    server.once("listening", () => {
      server.close(() => resolve(true));
    });
    server.listen(port, "127.0.0.1");
  });
}

function waitForDashboard(port: number, child: ChildProcessWithoutNullStreams): Promise<void> {
  const deadline = Date.now() + 30_000;
  return new Promise((resolve, reject) => {
    let settled = false;
    const fail = (error: Error) => {
      if (settled) return;
      settled = true;
      reject(error);
    };
    const pass = () => {
      if (settled) return;
      settled = true;
      resolve();
    };
    child.once("exit", (code) => fail(new Error(`Dashboard exited before startup with code ${code ?? "unknown"}.`)));
    const tick = async () => {
      try {
        const response = await fetch(`http://127.0.0.1:${port}`, { signal: AbortSignal.timeout(1_500) });
        if (response.ok) {
          pass();
          return;
        }
      } catch {
        // Retry until the startup deadline.
      }
      if (Date.now() > deadline) {
        fail(new Error(`Dashboard did not become available on 127.0.0.1:${port}.`));
        return;
      }
      setTimeout(tick, 500);
    };
    void tick();
  });
}

function registerShutdown(child: ChildProcessWithoutNullStreams) {
  const stop = () => {
    if (!child.killed) {
      child.kill();
    }
  };
  process.on("SIGINT", () => {
    stop();
    process.exit(0);
  });
  process.on("SIGTERM", () => {
    stop();
    process.exit(0);
  });
  process.on("exit", stop);
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
