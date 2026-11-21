import { chromium } from "@playwright/test";
import { expect } from "@playwright/test";

const BASE = "http://localhost:3100";
const browser = await chromium.launch();
const page = await browser.newPage();

const pageGets = [];
let recording = false;
page.on("request", (r) => {
  const u = new URL(r.url());
  if (recording && u.pathname === "/space/personal/projects") pageGets.push(Date.now());
});
const consoleLines = [];
page.on("console", (m) => {
  if (m.type() === "error" || m.type() === "warning") consoleLines.push(`${m.type()}: ${m.text().slice(0, 300)}`);
});
page.on("pageerror", (e) => consoleLines.push("pageerror: " + String(e).slice(0, 300)));

await page.goto(`${BASE}/register`);
await page.getByTestId("auth-username-input").fill("loopprobe1");
await page.getByTestId("auth-email-input").fill("loopprobe1@e2e.local");
await page.getByTestId("auth-nickname-input").fill("loopprobe1");
await page.getByTestId("auth-password-input").fill("E2ePassword123!");
await page.getByTestId("auth-password-confirm-input").fill("E2ePassword123!");
await page.getByTestId("auth-registration-code-input").fill("E2EREGCO");
await page.getByTestId("auth-agree-checkbox").click();
await page.getByTestId("auth-submit-button").click();
await expect(page).toHaveURL(/\/space\/personal\/dashboard$/, { timeout: 30000 });

await page.goto(`${BASE}/space/personal/projects`);
await expect(page.getByTestId("projects-list-page")).toBeVisible({ timeout: 15000 });

// 静置观察 6 秒：页面 RSC 请求的节奏
recording = true;
const start = pageGets.length;
await page.waitForTimeout(6000);
const count = pageGets.length - start;
const gaps = pageGets.slice(start + 1).map((t, i) => t - pageGets[start + i]);
console.log("PAGE_GETS_IN_6S:", count);
console.log("GAPS_MS:", gaps.join(","));
console.log("CONSOLE:", consoleLines.slice(0, 12).join("\n") || "(clean)");
await browser.close();
