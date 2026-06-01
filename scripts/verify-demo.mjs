import fs from "node:fs";
import path from "node:path";
import puppeteer from "puppeteer-core";

const dashboardUrl = process.env.ZECGUARD_DASHBOARD_URL ?? "http://localhost:3000";
const screenshotDir = path.join(process.cwd(), ".zecguard", "screens");
const statePath = path.join(process.cwd(), ".zecguard", "state.json");
const chromeCandidates = [
  process.env.CHROME_PATH,
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"
].filter(Boolean);

const executablePath = chromeCandidates.find((candidate) => fs.existsSync(candidate));
if (!executablePath) {
  throw new Error("Chrome or Edge was not found. Set CHROME_PATH to run demo verification.");
}

fs.mkdirSync(screenshotDir, { recursive: true });
if (fs.existsSync(statePath)) {
  fs.rmSync(statePath);
}

async function ensureWalletHasRoom() {
  const stateResponse = await fetch(`${dashboardUrl}/api/state`);
  if (!stateResponse.ok) return;
  const payload = await stateResponse.json();
  if ((payload.state?.wallet?.balanceZats ?? 0) < 5_000_000) {
    await fetch(`${dashboardUrl}/api/wallet/fund`, { method: "POST" });
  }
}

await ensureWalletHasRoom();

const browser = await puppeteer.launch({
  executablePath,
  headless: true,
  args: ["--no-sandbox", "--disable-gpu", "--window-size=1440,1100"]
});

const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 1100, deviceScaleFactor: 1 });

const errors = [];
page.on("console", (message) => {
  if (message.type() === "error") errors.push(message.text());
});
page.on("pageerror", (error) => errors.push(error.message));

await page.goto(dashboardUrl, { waitUntil: "domcontentloaded", timeout: 30_000 });
await page.waitForFunction(() => document.body.innerText.includes("Agent spending firewall"), { timeout: 15_000 });
await page.screenshot({ path: path.join(screenshotDir, "verify-01-loaded.png"), fullPage: true });

const loaded = await page.evaluate(() => ({
  title: document.title,
  hasContent: document.body.innerText.includes("Agent spending firewall"),
  hasOverlay: Boolean(document.querySelector("[data-nextjs-dialog], .vite-error-overlay, #webpack-dev-server-client-overlay"))
}));

await page.evaluate(() => {
  const textarea = document.querySelector("textarea");
  if (!textarea) throw new Error("Purchase request textarea not found");
  textarea.value = "Buy a private AI briefing about prompt-injection-safe ZEC agent payments.";
  textarea.dispatchEvent(new Event("input", { bubbles: true }));
});

await page.evaluate(() => {
  const button = Array.from(document.querySelectorAll("button")).find((item) =>
    item.textContent?.includes("Request quote")
  );
  if (!button) throw new Error("Request quote button not found");
  button.click();
});
await page.waitForFunction(() => document.body.innerText.includes("purchase waiting"), { timeout: 15_000 });
await page.screenshot({ path: path.join(screenshotDir, "verify-02-approval.png"), fullPage: true });

await page.evaluate(() => {
  const button = Array.from(document.querySelectorAll("button")).find((item) => item.textContent?.includes("Approve"));
  if (!button) throw new Error("Approve button not found");
  button.click();
});
await page.waitForFunction(
  () => document.body.innerText.includes("Private receipt verified") || document.body.innerText.includes("Private AI briefing delivered"),
  { timeout: 20_000 }
);
await page.screenshot({ path: path.join(screenshotDir, "verify-03-receipt.png"), fullPage: true });

const final = await page.evaluate(() => ({
  hasReceipt: document.body.innerText.includes("Private receipt verified") || document.body.innerText.includes("Private AI briefing delivered"),
  hasOverlay: Boolean(document.querySelector("[data-nextjs-dialog], .vite-error-overlay, #webpack-dev-server-client-overlay"))
}));

await browser.close();

const result = { loaded, final, errors };
console.log(JSON.stringify(result, null, 2));

if (!loaded.hasContent || loaded.hasOverlay || !final.hasReceipt || final.hasOverlay || errors.length > 0) {
  process.exitCode = 1;
}
