import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

function readRepoFile(relativePath: string): string {
  return fs.readFileSync(path.join(repoRoot, relativePath), "utf8");
}

describe("production-only runtime cleanup", () => {
  it("does not expose removed dashboard purchase controls", () => {
    const dashboard = readRepoFile("apps/dashboard/src/components/dashboard-client.tsx");
    const removedPanelTitle = ["Agent", "request"].join(" ");
    const removedQuoteButton = ["Request", "quote"].join(" ");
    const removedShortcut = ["Demo", "service"].join(" ");
    const removedRoutePrefix = ["/api", "demo"].join("/");

    expect(dashboard).not.toContain(removedPanelTitle);
    expect(dashboard).not.toContain(removedQuoteButton);
    expect(dashboard).not.toContain(removedShortcut);
    expect(dashboard).not.toContain(removedRoutePrefix);
  });

  it("does not reference the removed vendor workspace from root scripts", () => {
    const packageJson = JSON.parse(readRepoFile("package.json")) as { scripts: Record<string, string> };
    const scriptsText = JSON.stringify(packageJson.scripts);
    const removedWorkspaceSegment = ["demo", "vendor"].join("-");
    const removedWorkspaceName = ["@agentzcash", removedWorkspaceSegment].join("/");
    const removedWorkspacePath = ["apps", removedWorkspaceSegment].join("/");
    const removedScriptPrefix = ["de", "mo:"].join("");

    expect(scriptsText).not.toContain(removedWorkspaceName);
    expect(scriptsText).not.toContain(removedWorkspacePath);
    expect(Object.keys(packageJson.scripts).some((script) => script.startsWith(removedScriptPrefix))).toBe(false);
  });
});
