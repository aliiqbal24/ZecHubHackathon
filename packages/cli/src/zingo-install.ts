import { execFile, spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { getAgentZcashHome, getManagedZingoCliPath } from "@agentzcash/core";

const execFileAsync = promisify(execFile);

const ZINGOLIB_REPO = "https://github.com/zingolabs/zingolib.git";
const ZINGOLIB_LATEST_RELEASE_API = "https://api.github.com/repos/zingolabs/zingolib/releases/latest";

export interface InstallZingoCliOptions {
  force?: boolean;
  jobs?: number;
}

export function zingoCommand(): string {
  return process.env.AGENTZCASH_ZINGO_CLI ?? (fs.existsSync(getManagedZingoCliPath()) ? getManagedZingoCliPath() : "zingo-cli");
}

export async function ensureZingoAvailable() {
  try {
    await execFileAsync(zingoCommand(), ["--help"], { timeout: 15_000 });
  } catch {
    throw new Error(
      [
        `Zingo CLI binary not found or not executable: ${zingoCommand()}`,
        "Run AgentZcash's managed wallet dependency installer:",
        "  npx agentzcash install-wallet",
        "If installation cannot run on this machine, install Rust/Cargo and rerun the same command."
      ].join("\n")
    );
  }
}

export async function findZingoCommand(): Promise<string | undefined> {
  if (process.env.AGENTZCASH_ZINGO_CLI) {
    return process.env.AGENTZCASH_ZINGO_CLI;
  }

  const managed = getManagedZingoCliPath();
  if (fs.existsSync(managed)) {
    return managed;
  }

  const lookupCommand = process.platform === "win32" ? "where.exe" : "which";
  try {
    const { stdout } = await execFileAsync(lookupCommand, ["zingo-cli"], { timeout: 10_000 });
    return stdout.trim().split(/\r?\n/).find(Boolean);
  } catch {
    return undefined;
  }
}

export async function installManagedZingoCli(options: InstallZingoCliOptions = {}): Promise<string> {
  const existing = await findZingoCommand();
  if (existing && !options.force) {
    return existing;
  }

  await ensureCargoAvailable();

  const installRoot = path.dirname(path.dirname(getManagedZingoCliPath()));
  fs.mkdirSync(installRoot, { recursive: true });

  const releaseTag = await latestZingolibReleaseTag();
  const cargoArgs = [
    "install",
    "--git",
    ZINGOLIB_REPO,
    ...(releaseTag ? ["--tag", releaseTag] : []),
    "--package",
    "zingo-cli",
    "--root",
    installRoot,
    "--force",
    "--jobs",
    String(options.jobs ?? 1)
  ];

  console.log(`Installing zingo-cli into ${installRoot}`);
  if (releaseTag) {
    console.log(`Using zingolib release tag ${releaseTag}`);
  } else {
    console.log("Could not resolve latest zingolib release tag; Cargo will install from the repository default branch.");
  }
  console.log("Using one Cargo build job to reduce peak memory use.");

  await runForeground("cargo", cargoArgs, process.cwd(), {
    ...process.env,
    CARGO_BUILD_JOBS: String(options.jobs ?? 1)
  });

  const installed = getManagedZingoCliPath();
  if (!fs.existsSync(installed)) {
    throw new Error(`Cargo completed but ${installed} was not created.`);
  }

  await execFileAsync(installed, ["--help"], { timeout: 15_000 });
  return installed;
}

export function printZingoInstallGuidance(): void {
  console.log("AgentZcash installs zingo-cli automatically with Cargo:");
  console.log("");
  console.log("  npx agentzcash install-wallet");
  console.log("");
  console.log("If this fails before Cargo starts, install Rust from https://rustup.rs and rerun the same command.");
  console.log(`Managed install root: ${path.dirname(path.dirname(getManagedZingoCliPath()))}`);
  console.log(`Managed binary path: ${getManagedZingoCliPath()}`);
  console.log("");
  console.log("Advanced manual fallback:");
  console.log("");
  console.log("  cargo install --git https://github.com/zingolabs/zingolib.git --package zingo-cli --root ~/.agentzcash/zingo-cli --force --jobs 1");
}

async function ensureCargoAvailable(): Promise<void> {
  try {
    await execFileAsync("cargo", ["--version"], { timeout: 15_000 });
  } catch {
    throw new Error(
      [
        "Cannot install zingo-cli automatically because Rust Cargo was not found.",
        "Install Rust from https://rustup.rs, then rerun:",
        "  npx agentzcash install-wallet",
        `AgentZcash will install zingo-cli under ${path.join(getAgentZcashHome(), "zingo-cli")}.`
      ].join("\n")
    );
  }
}

async function latestZingolibReleaseTag(): Promise<string | undefined> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetch(ZINGOLIB_LATEST_RELEASE_API, {
      headers: {
        Accept: "application/vnd.github+json",
        "User-Agent": "agentzcash-cli"
      },
      signal: controller.signal
    });
    if (!response.ok) return undefined;
    const body = (await response.json()) as { tag_name?: unknown };
    return typeof body.tag_name === "string" && body.tag_name ? body.tag_name : undefined;
  } catch {
    return undefined;
  } finally {
    clearTimeout(timeout);
  }
}

async function runForeground(command: string, args: string[], cwd: string, env: NodeJS.ProcessEnv): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env,
      stdio: "inherit"
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} ${args.join(" ")} exited with code ${code ?? "unknown"}.`));
    });
  });
}
