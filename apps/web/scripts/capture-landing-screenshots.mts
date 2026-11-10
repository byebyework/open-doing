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
  const browser = await chromium.launch();

  // 任一步骤抛错也要关闭浏览器（失败仍由 main().catch 置非零退出码）。
  try {
    await mkdir(OUTPUT_DIR, { recursive: true });

    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      deviceScaleFactor: 2,
      locale: "zh-CN",
    });
    const page = await context.newPage();

    // 登录后的页面语言取自种子用户的 users.language（数据库值，而非本脚本的
    // locale 选项），因此截图假定该用户语言为 zh——与 `pnpm db:seed` 默认一致。
    await page.goto(`${BASE_URL}/login`, { waitUntil: "networkidle" });
    await page.locator("#login-username").fill("林夏");
    await page.locator("#login-password").fill("seed-password");
    await page.locator('button[type="submit"]').click();
    await page.waitForURL(/space/, { timeout: 30_000 });

    for (const name of SHOTS) {
      await page.goto(`${BASE_URL}/space/${TEAM_SLUG}/${name}`, {
        waitUntil: "networkidle",
      });
      // 截图前统一修正三处「非产品」视觉（仅捕获期生效，不写回产品代码）：
      // 1. 隐藏 Next.js dev tools 浮标；
      // 2. 侧栏是 sticky h-screen，全页截图时背景只铺到 900px 视口高度、下方
      //    露出灰底；截图期间改为随文档高度拉伸，保持侧栏背景连续；
      // 3. 月历网格按 overflow-x-auto 滚动容器实现，1440 视口只能完整显示
      //    周一–周五（周六被裁、右侧还有滚动阴影）。捕获期用 table-layout:
      //    fixed 让 7 列等分收进卡片，并隐藏滚动阴影，得到完整整月视图。
      await page.addStyleTag({
        content: `
          nextjs-portal { display: none !important; }
          div[class*="group/sidebar"] {
            position: static !important;
            height: auto !important;
            align-self: stretch !important;
          }
          [data-testid="calendar-grid-scroll"] > div {
            min-width: 0 !important;
          }
          [data-testid="calendar-grid-scroll"] table {
            table-layout: fixed !important;
            width: 100% !important;
          }
          [data-testid="calendar-scroll-shadow"] {
            display: none !important;
          }
        `,
      });
      // 鼠标可能停在上次点击位置（如登录按钮），导致页面元素带 hover 底色入镜；
      // 归位到左上角，随后的 1200ms 等待即作为状态回落的 settle 时间。
      await page.mouse.move(0, 0);
      // 等首屏图表 / 看板列渲染稳定，避免截到骨架屏或过渡帧。
      await page.waitForTimeout(1200);
      await page.screenshot({
        path: `${OUTPUT_DIR}${name}.png`,
        fullPage: true,
      });
      console.log(`[landing:shots] captured ${name}.png`);
    }

    await context.close();
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error("[landing:shots] failed:", error);
  process.exitCode = 1;
});
