import fs from "node:fs";
import path from "node:path";

const dashboardRoot = process.cwd();
const standaloneRoot = path.join(dashboardRoot, ".next", "standalone", "apps", "dashboard");

if (!fs.existsSync(standaloneRoot)) {
  console.warn("Next standalone output was not found; skipping standalone asset copy.");
  process.exit(0);
}

copyIfExists(path.join(dashboardRoot, ".next", "static"), path.join(standaloneRoot, ".next", "static"));
copyIfExists(path.join(dashboardRoot, "public"), path.join(standaloneRoot, "public"));

function copyIfExists(source, target) {
  if (!fs.existsSync(source)) return;
  fs.rmSync(target, { recursive: true, force: true });
  fs.cpSync(source, target, { recursive: true });
}
