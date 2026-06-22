import { execFile, spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { getAgentZcashHome, getManagedZingoCliPath } from "@agentzcash/core";

const execFileAsync = promisify(execFile);

const ZINGOLIB_REPO = "https://github.com/zingolabs/zingolib.git";
const ZINGOLIB_LATEST_RELEASE_API = "https://api.github.com/repos/zingolabs/zingolib/releases/latest";
const DEFAULT_PREBUILT_BASE_URL = "https://github.com/aliiqbal24/ZecHubHackathon/releases/latest/download";

export interface InstallZingoCliOptions {
  force?: boolean;
  jobs?: number;
  buildFromSource?: boolean;
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
        "For developer source builds only, install Rust/Cargo and run:",
        "  npx agentzcash install-wallet --build-from-source"
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

  if (!options.buildFromSource) {
    return installPrebuiltZingoCli();
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
  console.log("AgentZcash installs zingo-cli from a prebuilt release asset:");
  console.log("");
  console.log("  npx agentzcash install-wallet");
  console.log("");
  console.log("If the prebuilt asset is unavailable for this platform, developers can build from source:");
  console.log("");
  console.log("  npx agentzcash install-wallet --build-from-source");
  console.log("");
  console.log(`Managed install root: ${path.dirname(path.dirname(getManagedZingoCliPath()))}`);
  console.log(`Managed binary path: ${getManagedZingoCliPath()}`);
}

async function installPrebuiltZingoCli(): Promise<string> {
  const target = getManagedZingoCliPath();
  const installDir = path.dirname(target);
  fs.mkdirSync(installDir, { recursive: true });

  const assetUrl = process.env.AGENTZCASH_ZINGO_CLI_URL ?? `${prebuiltBaseUrl()}/${prebuiltAssetName()}`;
  console.log(`Downloading zingo-cli prebuilt binary from ${assetUrl}`);

  const binary = await downloadBytes(assetUrl);
  await verifyDownloadedBinary(binary, assetUrl);

  const tempFile = path.join(installDir, `.agentzcash-zingo-cli-${process.pid}-${Date.now()}${process.platform === "win32" ? ".exe" : ""}`);
  fs.writeFileSync(tempFile, binary);
  if (process.platform !== "win32") {
    fs.chmodSync(tempFile, 0o755);
  }

  try {
    await execFileAsync(tempFile, ["--help"], { timeout: 15_000 });
    fs.rmSync(target, { force: true });
    fs.renameSync(tempFile, target);
  } catch (error) {
    fs.rmSync(tempFile, { force: true });
    throw error;
  }

  return target;
}

async function verifyDownloadedBinary(binary: Buffer, assetUrl: string): Promise<void> {
  const expected = process.env.AGENTZCASH_ZINGO_CLI_SHA256;
  if (expected) {
    verifySha256(binary, expected);
    return;
  }

  if (process.env.AGENTZCASH_ZINGO_SKIP_CHECKSUM === "1") {
    console.log("Skipping zingo-cli checksum verification because AGENTZCASH_ZINGO_SKIP_CHECKSUM=1.");
    return;
  }

  const checksumUrl = process.env.AGENTZCASH_ZINGO_CLI_SHA256_URL ?? `${assetUrl}.sha256`;
  const checksum = (await downloadText(checksumUrl)).trim();
  verifySha256(binary, checksum);
}

function verifySha256(binary: Buffer, checksumText: string): void {
  const match = checksumText.match(/\b[a-fA-F0-9]{64}\b/);
  if (!match) {
    throw new Error("Downloaded zingo-cli checksum file did not contain a SHA-256 hash.");
  }

  const actual = crypto.createHash("sha256").update(binary).digest("hex");
  const expected = match[0].toLowerCase();
  if (actual !== expected) {
    throw new Error(`Downloaded zingo-cli checksum mismatch. Expected ${expected}, got ${actual}.`);
  }
}

function prebuiltBaseUrl(): string {
  return (process.env.AGENTZCASH_ZINGO_DOWNLOAD_BASE_URL ?? DEFAULT_PREBUILT_BASE_URL).replace(/\/$/, "");
}

function prebuiltAssetName(): string {
  const platform = platformKey();
  const arch = archKey();
  const extension = process.platform === "win32" ? ".exe" : "";
  return `agentzcash-zingo-cli-${platform}-${arch}${extension}`;
}

function platformKey(): string {
  switch (process.platform) {
    case "win32":
      return "windows";
    case "darwin":
      return "darwin";
    case "linux":
      return "linux";
    default:
      throw new Error(`No prebuilt zingo-cli binary is available for platform ${process.platform}.`);
  }
}

function archKey(): string {
  switch (process.arch) {
    case "x64":
      return "x64";
    case "arm64":
      return "arm64";
    default:
      throw new Error(`No prebuilt zingo-cli binary is available for architecture ${process.arch}.`);
  }
}

async function downloadBytes(url: string): Promise<Buffer> {
  const response = await fetchWithTimeout(url);
  if (!response.ok) {
    throw new Error(`Could not download zingo-cli prebuilt binary from ${url}: HTTP ${response.status}.`);
  }
  return Buffer.from(await response.arrayBuffer());
}

async function downloadText(url: string): Promise<string> {
  const response = await fetchWithTimeout(url);
  if (!response.ok) {
    throw new Error(`Could not download zingo-cli checksum from ${url}: HTTP ${response.status}.`);
  }
  return response.text();
}

async function fetchWithTimeout(url: string): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60_000);
  try {
    return await fetch(url, {
      headers: {
        "User-Agent": "agentzcash-cli"
      },
      signal: controller.signal
    });
  } finally {
    clearTimeout(timeout);
  }
}

async function ensureCargoAvailable(): Promise<void> {
  try {
    await execFileAsync("cargo", ["--version"], { timeout: 15_000 });
  } catch {
    throw new Error(
      [
        "Cannot install zingo-cli automatically because Rust Cargo was not found.",
        "Install Rust from https://rustup.rs, then rerun:",
        "  npx agentzcash install-wallet --build-from-source",
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
