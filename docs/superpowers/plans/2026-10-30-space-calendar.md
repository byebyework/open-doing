# Space Calendar (M4) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Per-space due-date month calendar (`/space/personal/calendar`, `/space/{teamSlug}/calendar`) with a right sidebar (this week's list + this month's upcoming), read-only, reusing Kanban's space patterns.

**Architecture:** New `features/calendar` domain module mirroring `features/kanban`: a service layer with visibility-scoped queries (reusing kanban's scope builders), one shared client component `SpaceCalendar` with a `variant` prop (personal/team), and two thin RSC pages that fetch by visible month and pass serializable props. The month grid is antd Calendar (fullscreen) customized via `cellRender` + `headerRender`; month navigation is URL state (`?month=YYYY-MM`) so the server refetches per month.

**Tech Stack:** Next.js 16 App Router (RSC + one client component), antd v6 Calendar + dayjs (`dayjs/locale/zh-cn` already loaded in `providers.tsx` → Monday-first), Drizzle ORM, Vitest (db mocked via Proxy pattern, serial execution), Playwright e2e.

**Spec:** `docs/V1.1_TASKS.md` §M4「已定」(2026-10-29) — the binding authority. Visual/copy ground truth: `docs/prototypes/space-calendar-personal.html` / `space-calendar-team.html` (read both before implementing the component; they pin copy, chip colors, and layout).

## Global Constraints

- UI 全站中文；组件以 antd v6 为准，不引入新依赖；Tailwind 只做布局/间距/微调。
- 页面默认 RSC；antd 交互组件只能在 `"use client"` 组件中；客户端组件不得 import 触库模块（service 只在 RSC 中调用）。
- `today` 统一 `todayInShanghai()`；RSC 把 `today` 作为 prop 传给 client 组件；日期算术用 UTC 日历日（`lib/today.ts` 模式），禁止组件里用本地时区取当前日期。
- 每个 Server Action 独立鉴权 —— 本里程碑只读、无新 action；页面鉴权复用 Kanban 页语义（个人 `requireUser()`；团队不存在/非成员一律 `notFound()`，不泄露存在性）。
- `docs/prototypes/space-calendar-*.html` 是视觉与文案基准；两者冲突时原型优先于本计划文字。
- 测试串行（`fileParallelism: false`）；vitest/drizzle-kit 不读 `.env.local`（本计划全部 unit 测试 mock db，无需真库）；commit message 英文，结尾 `Co-Authored-By: Claude Code <noreply@anthropic.com>`。
- 干净 checkout 上先 `pnpm --filter @open-doing/web exec next typegen` 再 `pnpm typecheck`。

**Controller rulings** (decisions the spec left open; recorded here so reviewers don't re-litigate):

1. **侧栏锚定「今天」，不随所显示月份翻动。** 「本周任务清单」恒为今天所在自然周；「本月即将到期」恒为今天所在月的剩余部分。依据：定稿文案「本周之后、本月以内」与每条「还有 N 天」倒计时都以今天为基准。成本若错：改为随月份取数是局部改动，代价小。
2. **「本月即将到期」排除 done 任务**（「即将到期」语义）；本周清单含 done（定稿明文「留在原位」）。成本：若用户要含 done，加一个条件即可。
3. **月网格恒为 42 天（6 周）**，与原型一致，即便某月 4 周排得下。成本：仅视觉，无数据成本。
4. **格内 chip 只显示标题**（原型即如此）；「还有 N 天」倒计时只出现在侧栏。定稿「未来任务带倒计时」由侧栏满足，原型是视觉权威。成本：若要格内也带，chip 内加一段文本即可。
5. **无截止日期入口仅个人页渲染**（团队原型位置是「未指派」说明文案）；两个 service 都返回 `noDueCount`（计数查询廉价），团队页不渲染该链接。成本：文案级改动。
6. **「还有 K 项」为静态文本**（v1 只读，无点开行为）。成本：后续加交互是纯客户端改动。
7. **空侧栏文案**（原型未画空态）：本周清单空 → 「本周没有要截止的任务」；本月即将到期空 → 「本月暂无即将到期的任务」；两者用 muted 次级文字样式。

## Review Focus

- **`?month=` 非法输入**（`2026-13`、`abc`、数组参数）→ 静默回退当前月，不 500、不白屏。（Task 4 页面测试）
- **周边界任务**：截止日恰为本周一 / 本周日 / 本月最后一天 → 恰好落在一个侧栏区块，本周清单与本月即将到期不重复（`weekEnd` 被排除在 upcoming 之外）。（Task 2 service 测试）
- **被移除的负责人**：团队任务 `assignee_id` 被置空后 → 渲染「未指派」tag，不崩溃、不渲染空头像。（Task 2 team 测试 + Task 5 e2e）
- **倒计时跨日误差**：`daysBetween` 用 UTC 日历日差，不因服务器 TZ 产生 ±1。（Task 1 纯函数测试）
- **个人空间零任务**：空数据 → 日历空网格正常渲染、无截止日期链接隐藏（`noDueCount === 0` 不渲染）、侧栏显示空态文案。（Task 2 + Task 3）

---

### Task 1: 日期纯函数 `getMonthGrid` / `getMonthEnd` / `daysBetween`

**Files:**
- Modify: `apps/web/src/lib/today.ts`
- Test: `apps/web/src/lib/today.test.ts`

**Interfaces:**
- Consumes: `addDays` from `@open-doing/types`（已在 `lib/today.ts` 使用）。
- Produces:
  - `getMonthGrid(month: string): { start: string; end: string }` — `month` 为 `"YYYY-MM"`；`start` = 当月 1 日所在周的周一（可落在上月），`end` = `start + 41 天`（恒 42 天网格，Ruling 3）。调用方保证 `month` 已校验合法。
  - `getMonthEnd(month: string): string` — `"YYYY-MM"` → 该月最后一天 `"YYYY-MM-DD"`。
  - `daysBetween(from: string, to: string): number` — 两个 `"YYYY-MM-DD"` 的日历日差（`to - from`，UTC 毫秒差 ÷ 86400000）；负数表示 `to` 在 `from` 之前。

- [ ] **Step 1: Write the failing tests**（追加到 `today.test.ts`，沿用文件内既有断言风格）

```ts
describe("getMonthGrid", () => {
  it("2026-10 → 2026-09-28 ~ 2026-11-08（10-01 是周四，6 周网格）", () => {
    expect(getMonthGrid("2026-10")).toEqual({ start: "2026-09-28", end: "2026-11-08" });
  });
  it("2027-02 → 2027-02-01 ~ 2027-03-14（2-01 恰为周一）", () => {
    expect(getMonthGrid("2027-02")).toEqual({ start: "2027-02-01", end: "2027-03-14" });
  });
});
describe("getMonthEnd", () => {
  it("2026-10 → 2026-10-31; 2026-02 → 2026-02-28", () => {
    expect(getMonthEnd("2026-10")).toBe("2026-10-31");
    expect(getMonthEnd("2026-02")).toBe("2026-02-28");
  });
});
describe("daysBetween", () => {
  it("同日为 0；未来为正；过去为负；跨月正确", () => {
    expect(daysBetween("2026-10-21", "2026-10-21")).toBe(0);
    expect(daysBetween("2026-10-21", "2026-10-26")).toBe(5);
    expect(daysBetween("2026-10-21", "2026-10-19")).toBe(-2);
    expect(daysBetween("2026-10-31", "2026-11-02")).toBe(2);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail** — `set -a; source apps/web/.env.local; set +a; pnpm vitest run apps/web/src/lib/today.test.ts`（env 仅是仓库惯例，本文件不需要库）→ Expected: FAIL（函数不存在）。
- [ ] **Step 3: Implement** — 与 `getWeekStart` 同口径：`Date.UTC(year, month-1, day)` 毫秒算术；`getMonthEnd` 用「次月 1 日 - 1 天」；不引入 dayjs（保持 lib/today 零依赖风格）。
- [ ] **Step 4: Run tests to verify they pass** — 同 Step 2 命令 → PASS（既有用例不回归）。
- [ ] **Step 5: Commit** — `feat(calendar): add month grid and day-diff date helpers`

### Task 2: Calendar service（个人 + 团队）

**Files:**
- Modify: `apps/web/src/features/kanban/service.ts`（仅把 `personalScope`、`teamScope` 加 `export`，其余不动）
- Create: `apps/web/src/features/calendar/service.ts`
- Test: `apps/web/src/features/calendar/service.test.ts`

**Interfaces:**
- Consumes: kanban 的 `personalScope(userId)` / `teamScope(teamId)`（本任务导出）；`tasks` / `projects` / `users` drizzle 表；`andDefined` 思路（calendar 内如需可自行内联 `!`）；`DbClient` 与默认参数 `= db` 约定同 kanban service。
- Produces（Task 3/4 消费，签名冻结）:

```ts
export interface CalendarTaskItem {
  id: string;
  title: string;
  /** YYYY-MM-DD；进本结构的一定有截止日期 */
  dueDate: string;
  /** status === "done" */
  done: boolean;
  projectId: string | null;
  /** 无项目时为 ""（沿用 KanbanCardItem 的非空 string 约定） */
  projectName: string;
  /** 团队任务的责任人；个人任务恒为本人 id；未指派为 null */
  assigneeId: string | null;
  /** 未指派为 null（Review Focus：成员被移除后不崩） */
  assigneeName: string | null;
}

export interface SpaceCalendarData {
  /** 所显示月份 42 天网格窗口内的任务，dueDate 升序、createdAt 降序平局 */
  items: CalendarTaskItem[];
  /** 可见范围内无截止日期的任务数（含任意状态，Ruling 5） */
  noDueCount: number;
  /** 今天所在自然周（周一起）7 天内截止的任务，dueDate 升序；含 done（Ruling 2） */
  weekItems: CalendarTaskItem[];
  /** (weekEnd, 今天所在月月末] 截止且未 done 的任务，dueDate 升序（Ruling 1/2） */
  monthUpcoming: CalendarTaskItem[];
}

export async function getPersonalSpaceCalendar(
  userId: string, month: string, today: string, client?: DbClient,
): Promise<SpaceCalendarData>
export async function getTeamSpaceCalendar(
  teamId: string, month: string, today: string, client?: DbClient,
): Promise<SpaceCalendarData>
```

- [ ] **Step 1: Write the failing tests**（mock `@/server/db/client`，用 kanban `service.test.ts` 的 Proxy 转发 `testDbRef.current` 模式；drizzle 查询构造走真实实现，断言捕获到的 SQL 条件或用内存数据源——以 kanban 测试文件现有做法为准，不发明新 mock 方式）。用例清单：
  - `getPersonalSpaceCalendar`：① 只含本人 personal 任务且 `due_date` 落在 `[grid.start, grid.end]`；② grid 窗口外截止的任务不进 `items`；③ done 任务按原 `due_date` 落格且 `done: true`；④ 无截止日期任务只进 `noDueCount` 不进 `items`；⑤ `weekItems` = `[weekStart, weekStart+6]`，跨月周的两侧边界任务都进；⑥ `monthUpcoming` 排除本周、排除月末之后、排除 done；⑦ 恰为 `weekEnd`（本周日）的任务只进 `weekItems` 不进 `monthUpcoming`；⑧ 排序 dueDate 升序。
  - `getTeamSpaceCalendar`：⑨ 团队范围按项目归属（含未指派）；⑩ `assigneeName` 来自 users join，未指派为 `null`；⑪ 他人团队任务不出现。
- [ ] **Step 2: Run tests to verify they fail** — `set -a; source apps/web/.env.local; set +a; pnpm vitest run apps/web/src/features/calendar/service.test.ts` → FAIL。
- [ ] **Step 3: Implement `features/calendar/service.ts`** — 单次实现要点：月份窗口 `getMonthGrid(month)`；侧栏窗口 `getWeekStart(today)`/`+6` 与 `(weekEnd, getMonthEnd(monthOf(today))]`（注意侧栏锚今天，Ruling 1）；无截止日期计数 = scope + `isNull(tasks.dueDate)`；join projects 取 `projectName`（team 还 join users 取 `assigneeName`），join 模式照抄 kanban `selectCards`/`selectTeamCards`；四个查询 `Promise.all`。排序 `dueDate asc, createdAt desc`。
- [ ] **Step 4: Run tests to verify they pass** — 同 Step 2 → PASS；再跑 `pnpm vitest run apps/web/src/features/kanban/service.test.ts` 确认导出改动无回归。
- [ ] **Step 5: Commit** — `feat(calendar): space calendar service with week and month windows`

### Task 3: `SpaceCalendar` client 组件

**Files:**
- Create: `apps/web/src/features/calendar/components/SpaceCalendar.tsx`
- Test: 无组件单测（M3 惯例：组件行为由 e2e 覆盖）；typecheck + build 兜底

**Interfaces:**
- Consumes: Task 2 的 `SpaceCalendarData` / `CalendarTaskItem`；`daysBetween`（Task 1）；`dayjs`（antd 同款依赖，已安装）。
- Produces:

```ts
export interface SpaceCalendarProps {
  variant: "personal" | "team";
  /** 所显示月份 "YYYY-MM"（页面已校验） */
  month: string;
  /** YYYY-MM-DD，服务端注入 */
  today: string;
  data: SpaceCalendarData;
  /** taskId → 详情页 href（页面构造；缺 href 的任务不渲染为链接） */
  taskHrefs: Record<string, string>;
  /** 模块根路径，翻月 push `${basePath}?month=YYYY-MM` */
  basePath: string;
  /** 「N 项任务没有截止日期 →」的跳转 href；仅 variant=personal 使用 */
  noDueHref?: string;
}
```

- [ ] **Step 1: Implement 组件骨架与布局** — `"use client"`；外层 flex：左日历 `flex-1 min-w-0`，右侧栏 `w-[320px] flex-none`；`<861px` 改纵向堆叠（Tailwind `min-[861px]:` 前缀，同 Kanban 页）。顶部说明行照原型：个人 = 无截止日期链接（`noDueCount > 0` 才渲染，文案「N 项任务没有截止日期 →(在 Dashboard 查看)」，href=`noDueHref`）+ 右侧「基准日期 {today}（{weekdayLabel(today)}）」；团队 = 「未指派 任务也会按截止日期出现在日历上」（tag 样式）+ 同款基准日期。链回看原型文件取精确文案与色值，色值用 Tailwind arbitrary values（Kanban 组件同做法）。
- [ ] **Step 2: antd Calendar 月历** — `<Calendar fullscreen />`，`value={dayjs(month + "-01")}` 受控；`headerRender` 自定义（标题「YYYY 年 M 月」+ ‹ › 「今天」按钮，`router.push` 写 `?month=`，今天 = `basePath` 不带参数）；`cellRender` 返回该日 chip 列表：按 `dueDate` 分组 `data.items`；着色口径 = done 绿底划线淡显 / `daysBetween(today, due) < 0` 红 / `= 0` 黄 / `1..3` 橙 / 其余灰（色值照原型 CSS block）；chip 内团队版渲染负责人头像（`assigneeName` 首字，未指派渲染「未指派」描边 tag）+ 标题，个人版渲染项目名 tag（有项目时）+ 标题；单格最多 3 条 + 静态「还有 K 项」（Ruling 6）；有 href 的包 next/link，无 href 只渲染文本。
- [ ] **Step 3: 侧栏两块** — ① 「本周任务」：hint「{weekStart} 周一 ~ {weekEnd} 周日 · {n} 项」（n = `weekItems.length`）；今天组置顶（label「今天 · {weekdayLabel} {MM-DD}」+ 数量 pill），其余按日分组升序；条目 = 状态点 + 团队头像/未指派 tag（个人 = 项目 tag）+ 标题（done 划线淡显留原位）+ 右侧 meta（逾期「已逾期 N 天」红 / 今天黄 / 临期「还有 N 天」橙 / 未来灰）；空态 Ruling 7。② 「本月即将到期」：hint「本周之后 · 本月以内」；条目 meta「{MM-DD} · 还有 N 天」；默认 5 条 + 「查看本月其余 K 项 →」本地 state 展开/收起；空态 Ruling 7。
- [ ] **Step 4: Verify** — `pnpm --filter @open-doing/web exec next typegen && pnpm typecheck && pnpm --filter @open-doing/web exec next build` 全绿。视觉对照不做手工 fixture hack，由 Task 5 e2e 与最终 review 在 dev 库上确认。
- [ ] **Step 5: Commit** — `feat(calendar): SpaceCalendar client component with sidebar`

### Task 4: 两个页面 + 占位页移除 calendar

**Files:**
- Create: `apps/web/src/app/(dashboard)/space/personal/calendar/page.tsx`
- Create: `apps/web/src/app/(dashboard)/space/[teamSlug]/calendar/page.tsx`
- Modify: `apps/web/src/app/(dashboard)/space/[teamSlug]/[module]/page.tsx`（`MODULE_LABELS` 删除 `calendar` 键；注释同步）

**Interfaces:**
- Consumes: Task 2 service、Task 3 组件、`moduleHref` / `personalTaskHref` / `teamTaskHref` / `spaceDashboardHref`（`lib/routes`）、`getTeamBySlug` / `getMembership`、`listPersonalProjects` / `listTeamProjects`。
- Produces: 路由 `/space/personal/calendar`、`/space/{teamSlug}/calendar`（占位页从此 404 这条路径）。

- [ ] **Step 1: 个人页** — `requireUser()`；`searchParams.month` 校验 `/^\d{4}-(0[1-9]|1[0-2])$/` 且不产生未来语义歧义——不合法（含数组）静默用当前月（Review Focus 第 1 条）；`getPersonalSpaceCalendar(user.id, month, today)`；`taskHrefs` = `personalTaskHref(card.id)`（items + weekItems + monthUpcoming 全量）；`noDueHref = spaceDashboardHref("personal")`；页头 h1「Calendar」+ sub 照原型个人版；传 props 渲染 `SpaceCalendar`；`metadata.title` 同 Kanban 页模式。
- [ ] **Step 2: 团队页** — 同团队 Kanban 页 404 语义（`getTeamBySlug` + `getMembership`，不存在/非成员 `notFound()`）；month 校验同上；`taskHrefs` 用 `projectSlugById` 反查（照抄 Kanban 团队页，`projectSlug` 缺失则不进 map）；页头 sub 照原型团队版（含「成员可见全部任务」）；不传 `noDueHref`。
- [ ] **Step 3: 占位页删除 calendar 键** — `MODULE_LABELS` 移除 `calendar: "Calendar"`，`isPlaceholderModule` 行为随对象自动收窄；顶部注释改为只列 analysis。
- [ ] **Step 4: Verify** — `pnpm --filter @open-doing/web exec next typegen && pnpm typecheck`；起 dev 库 + `pnpm db:seed` 后手工访问两条路由：默认当月、`?month=2026-11` 翻月、非法 `?month=xx` 回当月；`/space/personal/calendar` 占位 404。
- [ ] **Step 5: Commit** — `feat(calendar): space calendar pages and placeholder removal`

### Task 5: e2e + 文档收尾

**Files:**
- Create: `apps/web/e2e/flows/07-space-calendar.spec.ts`
- Modify: `docs/ARCHITECTURE.md`（§5 模块清单与 §12 或路由小节补 calendar，行文对齐 M3 的改法）
- Modify: `docs/V1.1_TASKS.md`（§M4 表格 ⬜ → ✅，附实现记录一行式，格式同 §M3）

**Interfaces:**
- Consumes: Task 1-4 全部产出；e2e 基建 `scripts/e2e-with-db-guard.sh`（严禁与 vitest 并行跑）。

- [ ] **Step 1: e2e 流** — 结构照抄 `flows/06-space-kanban.spec.ts`（登录方式、数据准备、`test.skip` 约定同款）。覆盖：① 个人日历渲染当月且种子任务 chip 出现在正确日期格；② 侧栏本周清单含该任务、done 划线；③ `?month=` 翻月到无任务月显示空网格、空侧栏文案可见，非法 `?month=xx` 静默回当月，「今天」按钮返回；④ 个人无截止日期链接可见并跳 Dashboard（若种子数据无无截止日期任务，先经 UI 新建一条再断言）；⑤ 团队日历 chip 带负责人头像、未指派任务渲染「未指派」tag；⑥ 非成员访问团队日历 404。
- [ ] **Step 2: Run e2e** — `pnpm --filter @open-doing/web test:e2e -- flows/07-space-calendar.spec.ts` → 全绿；再整包 `pnpm --filter @open-doing/web test:e2e` → 24 + 新增全绿（guard 通过）。
- [ ] **Step 3: 文档** — ARCHITECTURE 与 V1.1_TASKS 按上述描述更新；V1.1_TASKS 实现记录里写明两条 Ruling（侧栏锚今天、upcoming 排除 done）。
- [ ] **Step 4: 全量验证** — `pnpm typegen` 已含于各步；`pnpm lint && pnpm typecheck && pnpm test && pnpm build` 全绿。
- [ ] **Step 5: Commit** — `test(e2e): add space calendar flow and finalize M4 docs`
