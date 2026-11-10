# Landing Page + Motion 统一 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 新增对外 landing page(拉新 + 功能展示,真实产品截图,zh/en,Motion 动效),并把全项目动效统一到 Motion 库(迁移并删除 motion.css)。

**Architecture:** landing 是 RSC 根路由(`/`,已登录跳个人仪表盘),文案走 next-intl `landing` 命名空间,交互与动效下沉为 `motion/react` 客户端组件;浮层动画迁移通过重构 6 个 vendored shadcn 文件(退出期保持 Radix open)完成。

**Tech Stack:** Next.js App Router + RSC、next-intl、Motion(`motion/react`)、Tailwind 4 + tokens.css、Vitest + RTL、Playwright e2e。

**Spec:** `docs/superpowers/specs/2026-11-10-landing-page-design.md`(视觉基准:`docs/superpowers/specs/2026-11-10-landing-page-mockup/landing-page-mockup.html`)。执行者需同时读 spec 与本计划。

## Global Constraints

- 所有用户可见文案进 `apps/web/src/i18n/messages/{zh,en}.json` 的 `landing` 命名空间,zh/en 键结构一致;禁止硬编码(守卫:`src/i18n/cjk-guard.test.ts`、`src/i18n/messages-parity.test.ts`)。
- 组件颜色只用 token CSS 变量(`var(--ink-900)` 等),禁止字面量 hex;图标只用 `lucide-react`,禁止 emoji。
- 动画一律 `motion/react`;不引入其它动画库,不新增 CSS `@keyframes`。时长/缓动统一用 Task 2 的常量(数值与被删的 motion.css 一致)。
- 动效尊重 `prefers-reduced-motion`:Providers 挂 `<MotionConfig reducedMotion="user">`;循环动画在 reduce 下呈现静止终态。
- Motion 接管 `transform` 后,组件原有的 Tailwind `translate-*` 定位类必须改为 motion 的 `x`/`y` style(见 Task 11),否则定位被覆盖。
- 页面 RSC 优先;`"use client"` 只用于交互/动效片段,props 可序列化;文案在客户端组件内用 `useTranslations`(根布局已有 `NextIntlClientProvider`)。
- 触控目标 ≥44×44px;正文行宽 <80ch;文本对比度 ≥4.5:1;截图图片声明宽高防 CLS。
- Vitest 测试文件串行(仓库配置),不开启并行;本计划全部单测不依赖数据库(纯渲染/hook);e2e 用独立 3100 端口与 e2e 库(跑之前停 dev server)。
- Commit 遵循 Conventional Commits,英文主题;每条以 `Co-Authored-By: Claude Code <noreply@anthropic.com>` 结尾。
- 冻结契约不动:`(dashboard)/layout.tsx` 的 import 关系、AppShell。

## Review Focus

1. **已登录访问 `/`** 必须跳 `/space/personal/dashboard`,看不到 landing → e2e Task 10 用例 4。
2. **匿名语言切换持久化**:切 EN 后刷新仍是 EN(cookie `od_locale`)→ e2e Task 10 用例 2。
3. **浮层退出动画播完才卸载**:受控弹窗(如 ConfirmModal)关闭时内容在 exit 窗口内仍在 DOM,exitMs 后移除 → hook 单测 Task 2 + 人工核查 Task 14。
4. **Motion 不破坏弹窗居中/抽屉定位**:centering 从 translate 类迁移到 motion `x/y` 后,弹窗仍居中、抽屉仍贴边 → Task 11 组件测试 + 人工视觉。
5. **reduced-motion 下 landing 首屏直接呈现终态**(无动画、无空白闪烁)→ e2e Task 10 用例 5。

---

### Task 1: Motion 依赖与 MotionConfig

**Files:**
- Modify: `apps/web/package.json`(依赖)
- Modify: `apps/web/src/app/providers.tsx`
- Test: `apps/web/src/app/providers.test.tsx`

**Interfaces:**
- Produces: 全项目可从 `motion/react` 导入 `motion`/`AnimatePresence`/`useScroll`/`useTransform`/`MotionConfig`。

- [ ] **Step 1: 安装依赖**

```bash
pnpm --filter @open-doing/web add motion
```

- [ ] **Step 2: 在 providers.test.tsx 新增用例** `mounts MotionConfig with reducedMotion user` —— 断言 Providers 渲染不抛错且 children 可见(MotionConfig 的 reduce 行为由 Task 10 e2e 兜底,单测只锁挂载)。

- [ ] **Step 3: providers.tsx 引入 `<MotionConfig reducedMotion="user">`** 包裹现有 `<>` 内容(Toaster 保持在内)。

- [ ] **Step 4: 跑测试**

Run: `pnpm vitest run apps/web/src/app/providers.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit** `feat(motion): add motion dep and MotionConfig provider`

### Task 2: Overlay Motion 基础件(常量 + useHeldOpen)

**Files:**
- Create: `apps/web/src/components/ui/overlay-motion.ts`(`"use client"`,无 JSX)
- Test: `apps/web/src/components/ui/overlay-motion.test.tsx`

**Interfaces:**
- Produces(Task 5-8、11-13 全部依赖,签名如下):

```ts
// 数值与被删的 motion.css 逐一对应(文件头注释注明出处)
export const OD_MS = { overlayIn: 250, overlayOut: 200, modalIn: 420, modalOut: 200,
  popIn: 280, popOut: 150, sheetIn: 400, sheetOut: 300 } as const;
export const OD_EASE = {
  standard: [0.4, 0, 0.2, 1],      // --ease-standard
  decelerate: [0, 0, 0.2, 1],      // --ease-decelerate(入场)
  accelerate: [0.3, 0, 1, 1],      // --ease-accelerate(退场)
  springIn: [0.34, 1.4, 0.64, 1],  // 原 od-spring-in 曲线
  sheetIn: [0.32, 0.72, 0, 1],
} as const;

export const overlayVariants: Variants;  // open {opacity:1} / closed {opacity:0}
export const modalVariants: Variants;    // scale 0.88→1(60% 关键帧处 opacity 先到 1,同原 od-spring-in)
export const popVariants: Variants;      // scale 0.96→1 / 退出 0.97
export const sheetVariants: (side: "right"|"left"|"top"|"bottom") => Variants; // x/y ±100%

/** 受控关闭桥:open 翻 false 后返回值保持 true 共 exitMs,再落回 false;
    open 重新为 true 立即恢复 true。 */
export function useHeldOpen(open: boolean, exitMs: number): boolean;
```

- [ ] **Step 1: 写 hook 测试**(vi.useFakeTimers):true→false 后 100ms 仍 true;advance `exitMs` 后 false;false 期间重新 true 立即 true。
- [ ] **Step 2: 跑 → FAIL**

Run: `pnpm vitest run apps/web/src/components/ui/overlay-motion.test.tsx`
Expected: FAIL(模块不存在)

- [ ] **Step 3: 实现常量与 hook → 跑 → PASS**
- [ ] **Step 4: Commit** `feat(ui): add overlay motion constants and held-open bridge`

### Task 3: Landing 截图采集脚本与资产

**Files:**
- Create: `apps/web/scripts/capture-landing-screenshots.mts`
- Create: `apps/web/src/features/landing/assets/{dashboard,kanban,calendar,analysis}.png`
- Modify: `apps/web/package.json`(scripts)

**Interfaces:**
- Produces: 4 张 PNG(Task 6/7 以静态 `import` 引入,文件名固定)。

- [ ] **Step 1: 写脚本** — `import { chromium } from "@playwright/test"`;登录 `http://localhost:3000/login`(`#login-username`=林夏 / `#login-password`=seed-password),`waitForURL(/space/)`;viewport 1440×900、deviceScaleFactor 2;依次 goto `/space/growth-squad/{dashboard,kanban,calendar,analysis}`,`networkidle` + 1200ms 后全页截图,输出 `src/features/landing/assets/<name>.png`。脚本头注释注明前置条件:dev server 运行中 + `pnpm db:seed` 已执行。
- [ ] **Step 2: package.json 加** `"landing:shots": "tsx scripts/capture-landing-screenshots.mts"`。
- [ ] **Step 3: 运行**(dev server 在跑)

Run: `pnpm --filter @open-doing/web landing:shots`
Expected: 4 个 PNG 生成,侧栏为小鸟 logo(非原型 "O" 字标)。

- [ ] **Step 4: 目测校验** — Read 工具查看 dashboard.png:logo 正确、无弹窗遮挡、无截断。
- [ ] **Step 5: Commit** `feat(landing): add screenshot capture script and real product shots`(PNG 入库)

### Task 4: i18n `landing` 命名空间 + 匿名语言切换 action

**Files:**
- Modify: `apps/web/src/i18n/messages/zh.json`、`apps/web/src/i18n/messages/en.json`
- Create: `apps/web/src/features/landing/actions.ts`

**Interfaces:**
- Produces: `landing` 命名空间(Task 5-9 的 `useTranslations` 键全部来自此);`setAnonymousLocaleAction(input: { locale: string }): Promise<ActionResult<void>>` —— 非法 locale 返回 `{ ok:false, errors:{ form } }`;成功写 `od_locale` cookie(`LOCALE_COOKIE`、`LOCALE_COOKIE_MAX_AGE`、`sameSite:"lax"`、`path:"/"`)并 `revalidatePath("/")`。

- [ ] **Step 1: zh.json 加入 `landing` 顶层键**(按字母序插入现有顶层键之间):

```json
"landing": {
  "meta": { "title": "Open Doing — 个人与团队的任务管理", "description": "个人待办与团队项目同处一个系统。看板、日历、提醒、数据分析,开箱即用。" },
  "nav": { "features": "功能", "audiences": "个人 vs 团队", "faq": "常见问题", "login": "登录", "start": "免费开始", "languageLabel": "切换语言" },
  "hero": {
    "badge": "为小团队打造",
    "titleLine1": "把想法,",
    "titleLine2": "变成团队的每一天",
    "subtitle": "个人待办与团队项目同处一个系统。看板、日历、提醒、数据分析,开箱即用。",
    "ctaStart": "免费开始使用",
    "ctaLogin": "登录",
    "trust": "免费使用 · 开箱即用 · 个人空间与团队空间一体",
    "reminderCard": "提醒:需求评审 14:00"
  },
  "features": {
    "label": "功能",
    "title": "一个入口,看清所有事",
    "items": {
      "dashboard": { "tag": "仪表盘", "title": "项目健康度,一眼见底", "body": "在办项目、整体进度、临期与逾期任务自动聚合;每个项目的健康状态按任务完成度实时计算,不用追问、不用催。", "alt": "仪表盘截图:项目健康度与重要节点" },
      "kanban": { "tag": "看板", "title": "拖一下,任务就动了", "body": "待办、进行中、已完成三列看板,拖拽即流转;负责人、截止日、标签一目了然,团队谁在做什么,board 上见。", "alt": "看板截图:三列任务看板" },
      "calendar": { "tag": "日历", "title": "截止日,不用记", "body": "任务按日历铺开,临期自动提醒;今天该做什么、这周压着什么,打开日历就知道。", "alt": "日历截图:月历视图与任务分布" },
      "analysis": { "tag": "分析", "title": "团队负载,数据说话", "body": "完成趋势、成员负载、逾期分布自动成图;周会汇报,直接投这一页。", "alt": "分析截图:趋势与负载图表" }
    }
  },
  "audiences": {
    "label": "个人 vs 团队",
    "title": "一个人用得起,一群人用得开",
    "individual": { "title": "独立工作者", "body": "私人空间管理自己的待办与项目,想法不过夜;哪天拉上伙伴,邀请进团队空间即可,数据无缝延续。" },
    "team": { "title": "小团队", "body": "团队空间里按项目分工,看板协作、日历对齐、分析复盘;权限清清楚楚,成员只动自己的任务。" }
  },
  "faq": {
    "label": "常见问题",
    "title": "常见问题",
    "items": {
      "free": { "q": "免费吗?", "a": "免费。注册后全部功能均可使用,没有功能墙。" },
      "solo": { "q": "一个人也能用吗?", "a": "能。每个账号都有私人空间;之后随时创建团队空间,把伙伴邀请进来。" },
      "install": { "q": "需要安装吗?", "a": "不需要。浏览器打开即用,数据存在你自己的部署里。" }
    }
  },
  "cta": { "title": "现在,把第一件事做完", "subtitle": "免费创建账号,和团队一起把事做成", "start": "免费开始使用", "login": "登录" },
  "footer": { "copyright": "© 2026 Open Doing" }
}
```

- [ ] **Step 2: en.json 同结构英文**(键序完全一致):meta `{ "title": "Open Doing — Task management for individuals and teams", "description": "Personal to-dos and team projects in one system. Kanban, calendar, reminders, and analytics — ready out of the box." }`;nav `{ "features": "Features", "audiences": "Personal vs team", "faq": "FAQ", "login": "Log in", "start": "Get started", "languageLabel": "Switch language" }`;hero `{ "badge": "Built for small teams", "titleLine1": "Turn ideas into", "titleLine2": "your team's every day", "subtitle": "Personal to-dos and team projects in one system. Kanban, calendar, reminders, and analytics — ready out of the box.", "ctaStart": "Start for free", "ctaLogin": "Log in", "trust": "Free to use · Works out of the box · Personal and team spaces in one", "reminderCard": "Reminder: Design review 2:00 PM" }`;features `{ "label": "Features", "title": "One place to see everything", "items": { "dashboard": { "tag": "Dashboard", "title": "Project health at a glance", "body": "Active projects, overall progress, due-soon and overdue tasks, aggregated automatically. Each project's health is computed live from task completion — no chasing, no nudging.", "alt": "Dashboard screenshot: project health and milestones" }, "kanban": { "tag": "Kanban", "title": "Drag it, and the task moves", "body": "Three columns — to do, in progress, done. Drag to move. Assignee, due date, and labels at a glance; see who is doing what on the board.", "alt": "Kanban screenshot: three-column task board" }, "calendar": { "tag": "Calendar", "title": "Deadlines you don't have to memorize", "body": "Tasks laid out on the calendar with automatic due-soon reminders. Open the calendar to see what's due today and what's pressing this week.", "alt": "Calendar screenshot: month view with tasks" }, "analysis": { "tag": "Analysis", "title": "Team workload, in numbers", "body": "Completion trends, member workload, and overdue distribution, charted automatically. For the weekly meeting, just project this page.", "alt": "Analysis screenshot: trend and workload charts" } } }`;audiences `{ "label": "Personal vs team", "title": "Works for one, scales to many", "individual": { "title": "Solo workers", "body": "Manage your own tasks and projects in your personal space. When you bring in partners, invite them to a team space — everything carries over seamlessly." }, "team": { "title": "Small teams", "body": "Split work by project in the team space: collaborate on the kanban, align on the calendar, review with analytics. Permissions stay clear — members only touch their own tasks." } }`;faq `{ "label": "FAQ", "title": "Frequently asked questions", "items": { "free": { "q": "Is it free?", "a": "Yes. Every feature is available once you register — no feature paywall." }, "solo": { "q": "Can I use it alone?", "a": "Yes. Every account has a personal space; create a team space and invite partners whenever you're ready." }, "install": { "q": "Do I need to install anything?", "a": "No. It runs in your browser, and your data lives in your own deployment." } } }`;cta `{ "title": "Now, get that first thing done", "subtitle": "Create a free account and get things done with your team", "start": "Start for free", "login": "Log in" }`;footer `{ "copyright": "© 2026 Open Doing" }`。

- [ ] **Step 3: 写 action** — `features/landing/actions.ts`:`"use server"`;`setAnonymousLocaleAction` 不查登录态、不写 DB,cookie 段照抄 `features/users/actions.ts` 的 `updateLanguageAction`;locale 用 `normalizeLocale` 校验(不等则走 `standardFailuresForRequest().custom(...)` 通用失败,键放 `errors` 命名空间,如需新增 `errors.invalidLocale` 则 zh/en 同步加)。
- [ ] **Step 4: 跑守卫**

Run: `pnpm vitest run apps/web/src/i18n/messages-parity.test.ts apps/web/src/i18n/cjk-guard.test.ts`
Expected: PASS

- [ ] **Step 5: Commit** `feat(i18n): add landing namespace and anonymous locale action`

### Task 5: Landing 导航 + 语言切换 + 页脚

**Files:**
- Create: `apps/web/src/features/landing/components/LandingNav.tsx`
- Create: `apps/web/src/features/landing/components/LanguageSwitch.tsx`(`"use client"`)
- Create: `apps/web/src/features/landing/components/LandingFooter.tsx`
- Test: `apps/web/src/features/landing/components/LanguageSwitch.test.tsx`

**Interfaces:**
- Consumes: Task 4 的 `setAnonymousLocaleAction` 与 `landing.nav`/`landing.footer`;`BrandMark`(`@/components/ui/BrandMark`)。
- Produces: `LandingNav` —— sticky top-0、白底毛玻璃(`backdrop-blur` + 半透明 surface token),左 BrandMark + "Open Doing" 字标,中锚点 `#features`/`#audiences`/`#faq`,右 LanguageSwitch + 登录(`/login`)+「免费开始」(`/register`,主按钮 token 样式);`LanguageSwitch` —— `useTransition` + `setAnonymousLocaleAction`,「中 / EN」两个 ≥44px 命中区按钮,当前 locale 用 `text-primary` 加粗,pending 时 disabled;语言切换后的整页淡入由 Task 9 的 keyed 包裹承接。锚点 id 约定:各区块自带 `id` 且 `scroll-mt-16`。

- [ ] **Step 1: 写 LanguageSwitch 测试** — `vi.mock` action 返回 `{ok:true, data:undefined}`;点「EN」断言以 `{ locale: "en" }` 调用且 pending 期 disabled;当前 locale 高亮断言。
- [ ] **Step 2: 跑 → FAIL(组件不存在)**
- [ ] **Step 3: 实现三个组件**(文案全走 `useTranslations("landing")`;语言图标 `LanguagesIcon`)。
- [ ] **Step 4: 跑测试 → PASS;`pnpm vitest run apps/web/src/i18n/cjk-guard.test.ts` → PASS**
- [ ] **Step 5: Commit** `feat(landing): add nav, language switch and footer`

### Task 6: Hero(左文右拼贴 + Motion)

**Files:**
- Create: `apps/web/src/features/landing/components/Hero.tsx`(RSC 外壳)
- Create: `apps/web/src/features/landing/components/HeroAnimated.tsx`(`"use client"`)
- Create: `apps/web/src/features/landing/motion-presets.ts`(导出 `fadeUp` variants(y 24→0 + opacity)与 `staggerContainer`(staggerChildren 0.08);easing 引用 Task 2 的 `OD_EASE`)
- Test: `apps/web/src/features/landing/components/Hero.test.tsx`

**Interfaces:**
- Consumes: `landing.hero`;`assets/kanban.png`、`assets/calendar.png`;Task 5 锚点约定。
- Produces: `Hero`(data-testid="landing-hero")。布局照 mockup:左列徽标 chip(`Target` 图标)+ H1 两行(第二行渐变文字:`bg-clip-text text-transparent`,内联 `backgroundImage: "linear-gradient(135deg, var(--purple-600), var(--cyan-500))"`)+ 副文案 + 双 CTA(`next/link`,主 → `/register`、副 → `/login`,高 ≥44px)+ 信任行;右列双屏拼贴:日历 `rotate 2deg` 在后、看板 `rotate −2.5deg` 在前,`next/image` 带 width/height。动效:左列 stagger 淡入上移;双屏先后漂移落位(初值 y ±32、rotate 偏 2-3°,spring 收敛);提醒卡(`Bell`)最后弹入 + `y:[0,-6,0]` 循环(reduce 下 MotionConfig 自动静止);右列滚动视差 `useScroll`+`useTransform`(y ±24)。移动端(<1024px)单列,拼贴纵向堆叠、去 rotate。

- [ ] **Step 1: 写 Hero.test.tsx**(jsdom 断言最终 DOM):H1 两行文案、CTA href、提醒卡文本、图片 alt 来自 i18n。
- [ ] **Step 2: 跑 → FAIL**
- [ ] **Step 3: 实现 → 跑 → PASS;cjk-guard PASS**
- [ ] **Step 4: Commit** `feat(landing): add animated hero with product collage`

### Task 7: 功能区 + 双场景区

**Files:**
- Create: `apps/web/src/features/landing/components/FeaturesSection.tsx`(`"use client"`)
- Create: `apps/web/src/features/landing/components/AudiencesSection.tsx`(`"use client"`)
- Test: `apps/web/src/features/landing/components/FeaturesSection.test.tsx`

**Interfaces:**
- Consumes: `landing.features`/`landing.audiences`;4 张截图;Task 6 的 `fadeUp`。
- Produces: `FeaturesSection` —— `<section id="features" class="scroll-mt-16" data-testid="landing-features">`;区块引言 + 4 行图文交替(dashboard/kanban/calendar/analysis,奇偶行互换),每行 `whileInView`(`viewport={{ once: true, margin: "-80px" }}`)图/文错峰淡入;`AudiencesSection` —— `<section id="audiences" class="scroll-mt-16">`,双卡(individual 白底 / team 渐变浅底用 `--purple-08`/`--cyan-500` 的 token 组合),头部图标徽章(`User` 蓝 / `Users` 紫)。

- [ ] **Step 1: 写测试** — 4 个模块 tag/title 按序出现、图片 alt 正确、锚点 id 存在。
- [ ] **Step 2: 跑 → FAIL → 实现 → PASS;parity/cjk-guard PASS**
- [ ] **Step 3: Commit** `feat(landing): add features and audiences sections`

### Task 8: FAQ 手风琴 + 底部 CTA

**Files:**
- Create: `apps/web/src/features/landing/components/FaqSection.tsx`(`"use client"`)
- Create: `apps/web/src/features/landing/components/CtaSection.tsx`(`"use client"`)
- Test: `apps/web/src/features/landing/components/FaqSection.test.tsx`

**Interfaces:**
- Consumes: `landing.faq`/`landing.cta`;Task 6 的 `fadeUp`。
- Produces: `FaqSection` —— `<section id="faq" class="scroll-mt-16" data-testid="landing-faq">`;自建 motion 手风琴(不用 vendored Accordion):每项 `<button aria-expanded>` + `AnimatePresence` + `height:auto` 补间,`ChevronDownIcon` rotate 180°;默认第一项展开。`CtaSection` —— 渐变底 `var(--brand-gradient)` 色块,白底主按钮(→ `/register`)+ 描边登录;高光光晕伪元素以 motion `x` 往复(`repeat: Infinity, repeatType: "mirror"`,duration ≥8s);按钮 `whileHover={{ scale: 1.03 }}`。

- [ ] **Step 1: 写测试** — 点第二个问题头:`aria-expanded` 翻转、答案可见、第一项收起;键盘 Enter/Space 可切换。
- [ ] **Step 2: 跑 → FAIL → 实现 → PASS;parity/cjk-guard PASS**
- [ ] **Step 3: Commit** `feat(landing): add faq accordion and gradient cta`

### Task 9: 根路由接线 + 全页组合

**Files:**
- Create: `apps/web/src/features/landing/components/LandingPage.tsx`(RSC 组合)
- Create: `apps/web/src/features/landing/components/LandingContent.tsx`(`"use client"`,keyed 淡入包裹)
- Create: `apps/web/src/app/page.tsx`
- Delete: `apps/web/src/app/(dashboard)/page.tsx`

**Interfaces:**
- Produces: `/` 行为 —— `getCurrentUser()` 有会话 `redirect(spaceDashboardHref("personal"))`,否则 `LandingPage` 依次渲染 Nav → Hero → FeaturesSection → AudiencesSection → FaqSection → CtaSection → LandingFooter;`export async function generateMetadata()` 用 `landing.meta.title/description`。`LandingPage` 读 `getRequestLocale()` 把 `locale` 传给 `LandingContent`(`<div key={locale} initial={{opacity:0}} animate={{opacity:1}}>` 包全部区块)——语言切换后 RSC 刷新触发新内容淡入。

- [ ] **Step 1: 全仓搜依赖** `rg -n 'spaceDashboardHref|redirect\("/space/personal/dashboard"\)' apps/web/src apps/web/e2e --glob '!**/landing/**'`,核对「`/` 重定向」的既有断言并同步更新(若有)。
- [ ] **Step 2: 实现 + 删除旧 (dashboard)/page.tsx。**
- [ ] **Step 3: 全量单测** `pnpm test` → PASS(重点 globals.test.ts、providers.test.tsx)。
- [ ] **Step 4: 手动冒烟**(dev server):无痕开 `/` 见 landing;登录态开 `/` 跳 `/space/personal/dashboard`;切 EN 刷新仍 EN。
- [ ] **Step 5: Commit** `feat(landing): wire landing page at root route`

### Task 10: e2e 冒烟 flow

**Files:**
- Create: `apps/web/e2e/flows/11-landing.spec.ts`
- Modify: `apps/web/e2e/utils/testids.ts`(按既有模式加 `landing` 组:`hero/features/faq/cta/langEn/langZh/startButtons`)

**Interfaces:**
- Consumes: `e2e/utils/flows.ts` 的 `registerUser`/`loginUser`(用法见 flow 09)。

- [ ] **Step 1: 写用例**(`test.describe.configure({ timeout: 120_000 })`,风格照 flow 09,不依赖 seed):
  1. 匿名访问 `/`:hero/features/faq/cta testid 可见;主 CTA href 为 `/register`。
  2. 点 EN:出现 "Features";刷新仍 EN(cookie 持久化);点「中」切回,刷新仍中文。
  3. 点主 CTA → 落在 `/register` 且表单可见(到此为止,不断言注册成功)。
  4. `registerUser` 后访问 `/` → URL 为 `/space/personal/dashboard`。
  5. `page.emulateMedia({ reducedMotion: "reduce" })` 访问 `/`:hero 文案立即可见。
- [ ] **Step 2: 跑单条**

Run: `pnpm --filter @open-doing/web test:e2e -- flows/11-landing.spec.ts`(先停 dev server)
Expected: PASS

- [ ] **Step 3: Commit** `test(e2e): add landing page smoke flow`

### Task 11: 迁移 dialog.tsx + alert-dialog.tsx(modal 类)

**Files:**
- Modify: `apps/web/src/components/ui/shadcn/dialog.tsx`
- Modify: `apps/web/src/components/ui/shadcn/alert-dialog.tsx`
- Test: `apps/web/src/components/ui/shadcn/dialog.test.tsx`(新建)

**Interfaces:**
- Consumes: Task 2 全部导出。
- Produces: 行为契约(后续 Task 12/13 同构复用)——
  ①Root 桥接:`Dialog`/`AlertDialog` 内部维护 desiredOpen(受控 `props.open` 或非受控内部态,`onOpenChange` 仍即时回调消费方),Radix Root 的 `open` 传 `useHeldOpen(desiredOpen, OD_MS.modalOut)` 的 held 值;
  ②`Portal`/`Overlay`/`Content` 加 `forceMount`,内容包在 Portal 内的 `<AnimatePresence>`(或按 desiredOpen 直接切 variants,不依赖 AnimatePresence 卸载)按 held/desired 状态进出;
  ③`DialogContent` **删除** `translate-x-[-50%] translate-y-[-50%]` 类,改 motion `style={{ x: "-50%", y: "-50%" }}`;
  ④`DialogOverlay` 用 `overlayVariants`,入场 0.25s decelerate、退场 0.2s accelerate;内容 `modalVariants`,0.42s `springIn` / 0.2s `accelerate`;
  ⑤`od-overlay`/`od-modal` 类移除;header 注释更新:记录重构原因与原 motion.css 设计意图(iOS 弹簧、遮罩分层、退出比进入短)。

- [ ] **Step 1: 写 dialog.test.tsx** — ①受控 open=true 渲染内容;②翻 false:立即断言内容仍在 document(held 期),`vi.advanceTimersByTime(OD_MS.modalOut + 50)` 后移除;③held 期间重新 open,内容不消失;④关闭钮 sr-only 文案来自 `common.close`。
- [ ] **Step 2: 跑 → FAIL**
- [ ] **Step 3: 重构 dialog.tsx、alert-dialog.tsx**(alert-dialog 复用同桥接;`AlertDialogAction` 点击即关的默认行为保持)。
- [ ] **Step 4: 跑 dialog 测试 + `pnpm test` 全量 → PASS**
- [ ] **Step 5: 手动视觉核验**:dev server 打开含 ConfirmModal 的页面,开关弹窗:观感与迁移前一致、居中不偏、退出完整播放。
- [ ] **Step 6: Commit** `refactor(ui): migrate dialog and alert-dialog to motion`

### Task 12: 迁移 popover / dropdown-menu / select(pop 类)

**Files:**
- Modify: `apps/web/src/components/ui/shadcn/popover.tsx`、`dropdown-menu.tsx`、`select.tsx`
- Test: `apps/web/src/components/ui/shadcn/popover.test.tsx`(新建,模式同 Task 11)

**Interfaces:**
- Consumes: Task 2(`popVariants`、`useHeldOpen`、`OD_MS.popOut`)。
- Produces: 行为契约同 Task 11(exit 150ms);缩放原点跟随 Radix:`style={{ transformOrigin: "var(--radix-popover-content-transform-origin)" }}`(select/dropdown 用各自同名 CSS 变量);`od-popover` 类移除。

- [ ] **Step 1-4: 测试 → FAIL → 实现 → `pnpm test` PASS → Commit** `refactor(ui): migrate popover, dropdown-menu, select to motion`

### Task 13: 迁移 sheet.tsx + 删除 motion.css

**Files:**
- Modify: `apps/web/src/components/ui/shadcn/sheet.tsx`
- Delete: `apps/web/src/app/motion.css`
- Modify: `apps/web/src/app/globals.css:7`(删 `@import "./motion.css";`)
- Test: `apps/web/src/components/ui/shadcn/sheet.test.tsx`(新建)

**Interfaces:**
- Consumes: Task 2(`sheetVariants(side)`、`OD_MS.sheetOut`)。
- Produces: 四向抽屉进出场(motion `x`/`y` 百分比;side 的 inset 定位类保留);`od-sheet*` 类全部移除。

- [ ] **Step 1: 写测试**(right 侧:closed 态 x "100%"、held 期内容在 DOM、超时移除;side→variant 映射断言)。
- [ ] **Step 2: 跑 → FAIL → 实现 → PASS**
- [ ] **Step 3: 删除 motion.css 与 globals.css 的 import;`rg "od-overlay|od-modal|od-popover|od-sheet" apps/web/src` 零命中。**
- [ ] **Step 4: `pnpm test` 全量 PASS;手动核验抽屉四向开合。**
- [ ] **Step 5: Commit** `refactor(ui): migrate sheet to motion and drop motion.css`

### Task 14: 受控消费方审计

**Files:**
- 审计(必要时微调):`src/components/ui/ConfirmModal.tsx`、`src/features/tasks/components/TaskDetailView.tsx`、`src/components/layout/MobileNav.tsx`、四个 `NewTaskModal*`,以及 `rg -l "open=\{open\}" apps/web/src` 的其它命中。

**Interfaces:**
- Consumes: Task 11-13 的新契约(关闭延迟 150-300ms)。

- [ ] **Step 1: 逐一检查**「`setOpen(false)` 之后同步执行」的逻辑(焦点归还、表单 reset、紧随的 refetch/router 操作):延迟关闭是否造成可感知问题;有问题的把后续动作挂到关闭确认时机(dialog 的 `onAnimationComplete` 或 held 结束点)。
- [ ] **Step 2: 全量回归** `pnpm test` + 手动过核心弹窗流(新建任务、删除确认、移动端抽屉导航)。
- [ ] **Step 3: Commit**(如有改动)`fix(ui): audit controlled overlay consumers for delayed close`

### Task 15: 终检与视觉比对

**Files:** 无新增(只修发现的问题)。

- [ ] **Step 1: Web Interface Guidelines 评审** — WebFetch `https://raw.githubusercontent.com/vercel-labs/web-interface-guidelines/main/command.md`,对 `src/features/landing/components/` 全部文件跑规则检查,逐条修复发现(重点:焦点可见、触控目标、对比度、语义化按钮/链接)。
- [ ] **Step 2: 全量门禁**

Run: `pnpm lint && pnpm test && pnpm --filter @open-doing/web exec next typegen && pnpm typecheck`
Expected: 全绿

- [ ] **Step 3: 视觉比对** — 打开 `docs/superpowers/specs/2026-11-10-landing-page-mockup/landing-page-mockup.html` 与 `http://localhost:3000/`,1440×900 与 390×844 两档截图(Playwright CLI)比对,修正明显偏差。
- [ ] **Step 4: e2e 全量** `pnpm --filter @open-doing/web test:e2e`(先停 dev server)→ PASS。
- [ ] **Step 5: Commit**(如有修正)`fix(landing): address interface guidelines findings`
