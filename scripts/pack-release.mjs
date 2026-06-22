import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const outputDir = path.join(root, "release-artifacts", "npm");
const npmCommand = process.env.npm_execpath
  ? { command: process.execPath, baseArgs: [process.env.npm_execpath] }
  : { command: process.platform === "win32" ? "npm.cmd" : "npm", baseArgs: [] };
const workspaces = [
  { name: "@agentzcash/core", path: "packages/core", required: ["dist/index.js", "dist/index.d.ts"] },
  { name: "@agentzcash/mcp-server", path: "apps/mcp-server", required: ["dist/index.js", "dist/stdio.js", "dist/tools.js"] },
  {
    name: "@agentzcash/dashboard",
    path: "apps/dashboard",
    required: [".next/standalone/apps/dashboard/server.js", ".next/static"]
  },
  { name: "agentzcash", path: "packages/cli", required: ["dist/index.js"] }
];

const manifest = {
  generatedAt: new Date().toISOString(),
  packages: []
};

assertExactInternalVersions();
fs.rmSync(outputDir, { recursive: true, force: true });
fs.mkdirSync(outputDir, { recursive: true });

for (const workspace of workspaces) {
  assertBuildOutput(workspace);
  const before = new Set(fs.readdirSync(outputDir));
  execFileSync(npmCommand.command, [...npmCommand.baseArgs, "pack", "--silent", "--pack-destination", outputDir], {
    cwd: path.join(root, workspace.path),
    stdio: "inherit"
  });

  const packed = fs.readdirSync(outputDir).find((file) => !before.has(file) && file.endsWith(".tgz"));
  if (!packed) {
    throw new Error(`npm pack did not create a tarball for ${workspace.name}.`);
  }

  const tarballPath = path.join(outputDir, packed);
  const sha256 = crypto.createHash("sha256").update(fs.readFileSync(tarballPath)).digest("hex");
  fs.writeFileSync(`${tarballPath}.sha256`, `${sha256}  ${packed}\n`);
  manifest.packages.push({
    name: workspace.name,
    tarball: packed,
    sha256
  });
}

fs.writeFileSync(path.join(outputDir, "agentzcash-release-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`Packed ${manifest.packages.length} packages into ${path.relative(root, outputDir)}`);

function assertBuildOutput(workspace) {
  for (const relativePath of workspace.required) {
    const fullPath = path.join(root, workspace.path, relativePath);
    if (!fs.existsSync(fullPath)) {
      throw new Error(`Missing ${workspace.name} build output: ${path.relative(root, fullPath)}. Run npm run build first.`);
    }
  }
}

function assertExactInternalVersions() {
  const packagePaths = [
    "packages/cli/package.json",
    "apps/dashboard/package.json",
    "apps/mcp-server/package.json"
  ];

  for (const packagePath of packagePaths) {
    const fullPath = path.join(root, packagePath);
    const parsed = JSON.parse(fs.readFileSync(fullPath, "utf8"));
    const dependencies = parsed.dependencies ?? {};
    for (const [name, version] of Object.entries(dependencies)) {
      if (!name.startsWith("@agentzcash/")) continue;
      if (version === "*" || String(version).startsWith("workspace:")) {
        throw new Error(`${packagePath} uses non-publishable dependency ${name}: ${version}`);
      }
    }
  }
}
