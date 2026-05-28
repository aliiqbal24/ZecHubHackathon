import fs from "node:fs";
import path from "node:path";

const statePath = path.join(process.cwd(), ".zecguard", "state.json");

if (fs.existsSync(statePath)) {
  fs.rmSync(statePath);
  console.log("Removed .zecguard/state.json");
} else {
  console.log("Demo state is already clean");
}
