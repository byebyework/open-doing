/**
 * 采集 landing 页使用的真实产品截图（4 张 PNG，后续静态 import）。
 *
 * 前置条件：
 * 1. 开发服务器已在 http://localhost:3000 运行（本仓库约定捕获主检出的空间页，
 *    种子数据与小写小鸟 logo 与工作树一致，无需在本工作树另起 dev server）；
 * 2. 已执行 `pnpm db:seed`（林夏 / seed-password 与 growth-squad 团队数据入库）。
 *
 * 用法：`pnpm --filter @open-doing/web landing:shots`
 *
 * 说明：截图使用 1440×900 视口 + 2 倍 DPR（输出 2880px 宽），页面无 URL 前缀
 * 语言参数，登录后依次访问团队的 dashboard / kanban / calendar / analysis。
 * 脚本会隐藏 Next.js dev tools 指示器，避免营销截图出现开发态浮标。
 */
import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { chromium } from "@playwright/test";

const BASE_URL = "http://localhost:3000";
const TEAM_SLUG = "growth-squad";
/** 四个模块与输出文件名一一对应。 */
const SHOTS = ["dashboard", "kanban", "calendar", "analysis"] as const;

const OUTPUT_DIR = fileURLToPath(
  new URL("../src/features/landing/assets/", import.meta.url),
);

async function main(): Promise<void> {
  await mkdir(OUTPUT_DIR, { recursive: true });

  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 2,
    locale: "zh-CN",
  });
  const page = await context.newPage();

  await page.goto(`${BASE_URL}/login`, { waitUntil: "networkidle" });
  await page.locator("#login-username").fill("林夏");
  await page.locator("#login-password").fill("seed-password");
  await page.locator('button[type="submit"]').click();
  await page.waitForURL(/space/, { timeout: 30_000 });

  for (const name of SHOTS) {
    await page.goto(`${BASE_URL}/space/${TEAM_SLUG}/${name}`, {
      waitUntil: "networkidle",
    });
    // 截图前统一修正两处「非产品」视觉：
    // 1. 隐藏 Next.js dev tools 浮标；
    // 2. 侧栏是 sticky h-screen，全页截图时背景只铺到 900px 视口高度、下方露出
    //    灰底；截图期间改为随文档高度拉伸，保持侧栏背景连续。
    await page.addStyleTag({
      content: `
        nextjs-portal { display: none !important; }
        div[class*="group/sidebar"] {
          position: static !important;
          height: auto !important;
          align-self: stretch !important;
        }
      `,
    });
    // 等首屏图表 / 看板列渲染稳定，避免截到骨架屏或过渡帧。
    await page.waitForTimeout(1200);
    await page.screenshot({
      path: `${OUTPUT_DIR}${name}.png`,
      fullPage: true,
    });
    console.log(`[landing:shots] captured ${name}.png`);
  }

  await context.close();
  await browser.close();
}

main().catch((error) => {
  console.error("[landing:shots] failed:", error);
  process.exitCode = 1;
});
