import { expect, test } from "@playwright/test";

import { TEST_IDS } from "../utils/testids";
import { registerUser, uniqueUsername } from "../utils/flows";

/**
 * 关键流 11：落地页冒烟（landing page smoke）。
 *
 * 覆盖（对照落地页计划 Task 10 的五条验收）：
 * 1. 匿名访问 `/`：hero / features / faq / cta 区块可见，首屏主 CTA 指向
 *    `/register`（默认匿名 locale 回落中文）；
 * 2. 点 EN：RSC 以英文重渲染；硬刷新仍是 EN（od_locale cookie 持久化）；
 *    点「中」切回并刷新仍是中文；
 * 3. 点主 CTA 落在 `/register` 且注册表单可见（到此为止，不断言注册成功）；
 * 4. 已登录用户访问 `/` 由服务端重定向到个人 Dashboard（不见落地页）；
 * 5. 系统「减弱动态效果」下首屏文案最终到达 opacity 1（transform 被抑制，
 *    opacity 仍补间；关键是真正可见而非「立刻可见」）。
 *
 * 不依赖 seed：用例 4 通过注册页自建账号（registration code 由 global-setup
 * 预置）。其余用例均为独立匿名上下文，语言切换只写 cookie。
 *
 * 说明：本文件不写中文字面量——中文界面断言由 `html lang="zh-CN"` 与
 * 语言按钮的 `aria-pressed` 共同覆盖（这两者都由服务端 request locale 驱动），
 * 因此无需给 cjk-guard 增加白名单条目。
 */
test.describe.configure({ timeout: 120_000 });

test.describe("flow 11: landing page smoke", () => {
  test("anonymous visit renders all sections and the primary CTA links to /register", async ({
    page,
  }) => {
    await page.goto("/");

    for (const testId of [
      TEST_IDS.landing.hero,
      TEST_IDS.landing.features,
      TEST_IDS.landing.faq,
      TEST_IDS.landing.cta,
    ]) {
      await expect(page.getByTestId(testId)).toBeVisible();
    }

    // 无 od_locale cookie 时匿名请求回落 zh（与登录用户的账号语言无关）。
    await expect(page.locator("html")).toHaveAttribute("lang", "zh-CN");

    // 首屏左列的第一个链接即主 CTA；按钮文案随语言变化，按注册入口选择器
    // （TEST_IDS.landing.registerLinks）断言，避免依赖链接渲染顺序。
    const hero = page.getByTestId(TEST_IDS.landing.hero);
    const primaryCta = hero.locator(TEST_IDS.landing.registerLinks);
    await expect(primaryCta).toHaveCount(1);
    await expect(primaryCta).toHaveAttribute("href", "/register");
  });

  test("switching to EN survives a reload and can switch back to zh", async ({
    page,
  }) => {
    await page.goto("/");

    const html = page.locator("html");
    const hero = page.getByTestId(TEST_IDS.landing.hero);
    const features = page.getByTestId(TEST_IDS.landing.features);

    await expect(html).toHaveAttribute("lang", "zh-CN");
    await expect(page.getByTestId(TEST_IDS.landing.langZh)).toHaveAttribute(
      "aria-pressed",
      "true",
    );

    // EN chip → setAnonymousLocaleAction 写 od_locale + revalidatePath("/")，
    // RSC 以英文重渲染。等待 html lang 变化而不是固定 sleep。
    await page.getByTestId(TEST_IDS.landing.langEn).click();
    await expect(html).toHaveAttribute("lang", "en-US");
    await expect(page.getByTestId(TEST_IDS.landing.langEn)).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    // 只在英文 locale 出现的文案：features 区块引言标题（结构性 h2，非 tag）
    // 与 hero 主 CTA "Start for free"。标题按 role 作用域定位，避免未来 tag
    // 含 "Features" 时 getByText 触发 strict mode 冲突。
    await expect(
      features.getByRole("heading", {
        level: 2,
        name: "One place to see everything",
      }),
    ).toBeVisible();
    await expect(
      hero.getByRole("link", { name: "Start for free" }),
    ).toBeVisible();

    // 硬刷新：locale cookie 持久化，仍是英文。
    await page.reload();
    await expect(html).toHaveAttribute("lang", "en-US");
    await expect(
      features.getByRole("heading", {
        level: 2,
        name: "One place to see everything",
      }),
    ).toBeVisible();

    // 「中」chip 切回中文；英文标题从页面上消失。
    await page.getByTestId(TEST_IDS.landing.langZh).click();
    await expect(html).toHaveAttribute("lang", "zh-CN");
    await expect(page.getByTestId(TEST_IDS.landing.langZh)).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect(
      features.getByRole("heading", {
        level: 2,
        name: "One place to see everything",
      }),
    ).toHaveCount(0);

    // 再硬刷新：仍为中文。
    await page.reload();
    await expect(html).toHaveAttribute("lang", "zh-CN");
    await expect(page.getByTestId(TEST_IDS.landing.langZh)).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect(
      features.getByRole("heading", {
        level: 2,
        name: "One place to see everything",
      }),
    ).toHaveCount(0);
  });

  test("primary CTA opens the register page with a visible form", async ({
    page,
  }) => {
    await page.goto("/");

    // 主 CTA 位于 hero；按注册入口选择器（TEST_IDS.landing.registerLinks）
    // 锚定，避免依赖随界面语言变化的按钮文案。
    await page
      .getByTestId(TEST_IDS.landing.hero)
      .locator(TEST_IDS.landing.registerLinks)
      .first()
      .click();

    await expect(page).toHaveURL(/\/register$/, { timeout: 30_000 });
    await expect(page.getByTestId(TEST_IDS.auth.usernameInput)).toBeVisible();
  });

  test("signed-in users are redirected from / to the personal dashboard", async ({
    page,
  }) => {
    await registerUser(page, uniqueUsername("e2e_landing"));

    // 重定向发生在服务端（RootPage → redirect），等待最终 URL。
    await page.goto("/");
    await page.waitForURL(/\/space\/personal\/dashboard$/, { timeout: 30_000 });

    // 已登录时不应渲染落地页。
    await expect(page.getByTestId(TEST_IDS.landing.hero)).toHaveCount(0);
  });

  test("reduced motion still settles the hero copy to full opacity", async ({
    page,
  }) => {
    // MotionConfig reducedMotion="user" 只抑制 transform 类动画；fadeUp 的
    // opacity 仍会补间到 1。这里的关键断言是「最终真正可见」而非「立刻可见」。
    // toBeVisible 对 opacity 视而不见（opacity:0 也算 visible），所以必须用
    // toHaveCSS 钉住 opacity=1。
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/");

    const hero = page.getByTestId(TEST_IDS.landing.hero);
    const title = hero.getByRole("heading", { level: 1 });
    const primaryCta = hero.locator(TEST_IDS.landing.registerLinks);

    await expect(hero).toBeVisible();
    await expect(title).toBeVisible();
    // 标题确实带有文案（两行 span），不是空的占位元素。
    await expect(title).toHaveText(/\S/);

    // fadeUp 的 opacity 挂在标题（motion.h1）与 CTA 行的 motion.div 上；
    // <a> 自身的 computed opacity 恒为 1，故 CTA 检查其直接父元素（动画行）。
    await expect(title).toHaveCSS("opacity", "1");
    await expect(primaryCta.locator("..")).toHaveCSS("opacity", "1");
  });
});
