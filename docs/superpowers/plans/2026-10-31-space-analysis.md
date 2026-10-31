# M5 Space Analysis Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 两个空间各一个只读 Analysis 聚合页(个人/团队 variant),自绘柱状图 + 横向对比条 + 列表,不引入图表库。

**Architecture:** 沿 Kanban/Calendar 的 variant 模式:新 `features/analysis` 模块 = 纯函数 `buckets.ts`(range 解析与分桶)+ `service.ts`(个人/团队两个取数函数,DTO 可序列化)+ server 组件 `SpaceAnalysis.tsx`(variant 分支渲染)+ 一个 client 组件 `AnalysisRangeSelector.tsx`(写回 `?range=`)。团队页快照区块(整体进度/成员负载/项目健康度)复用 `features/dashboard/team-overview/service.ts` 的 `getTeamOverview`,趋势/僵尸任务自建查询。

**Tech Stack:** Next.js 16 RSC(页面默认服务端)、Drizzle ORM(PostgreSQL 17)、Tailwind(布局)+ 少量页内 CSS(图表)、Vitest(串行)+ Playwright e2e。

**Spec:** `docs/V1.1_TASKS.md` §M5「已定」;视觉与文案基准 `docs/prototypes/space-analysis-personal.html` / `space-analysis-team.html`(已审核通过,冲突时以原型为准,沿 M3/M4 先例)。

## Global Constraints

- **不引入图表库**:全部图表自绘 div/CSS(§M5 图表选型裁定)。
- **统计卡恒为当前快照**,不随 `?range=` 变化;range 只作用于趋势区块。
- **`?range=` 宽容语义**:合法值 `7|30|90`;缺失 / 非法 / 数组参数一律静默回退 30(沿 M4 month 同款,不 500 不报错)。粒度:7/30 天按日,90 天按周(周一起始)。
- **完成日 = `updated_at` 的上海日历日**(M3 代理口径,与 Calendar/通知同源);创建日 = `created_at` 同理。时间戳 → 上海日历日的换算必须显式 `AT TIME ZONE 'Asia/Shanghai'`(沿 `getMyTaskStats` 注释约定),不得跟随会话时区。
- **「今天」一律 `todayInShanghai()`**,RSC 取得后作为 prop 下传,组件内不得自取本地日期。
- **按时率**:分母 = 有截止日期(`dueDate` 非空)且完成日在固定近 30 天窗口内的已完成任务——注意这是**固定 30 天窗口,不随 `?range=`**(原型文案「近 30 天」为固定窗口;统计卡不响应 range);无截止日期不进分母;按时 = 完成日 ≤ 截止日;分母为 0 时 `ratePercent: null`,页面渲染「—」。
- **僵尸任务** = `status = 'in_progress'` 且 `updated_at < (today - 14) 的上海零点 timestamptz`;边界:完成更新恰好发生在 `today-14` 当天的不算僵尸。
- **个人页口径 = `eq(tasks.assigneeId, userId)`**(个人 + 指派给我的团队任务,与 `getMyTaskStats`/Dashboard 同口径;**不是** kanban `personalScope`——原型项目对比含团队项目、callout 明示「含个人与指派给你的团队任务」)。团队页口径 = `teamScope(teamId)`(kanban service 导出,未指派天然纳入)。
- **未来截止分布固定 14 天按日**(今天起含今天),只计未完成任务;逾期不计入(原型 callout)。
- 权限:团队 Analysis 页团队不存在 / 非成员一律 `notFound()`(不泄露存在性);模块只读,**无 Server Actions**。
- 全站中文;组件不新建 ConfigProvider;`globals.css` 不加全局选择器——图表样式一律 Tailwind 原子类 + inline `style`(不加 `<style>` 标签、不写全局 CSS)。
- 测试:vitest 串行(`fileParallelism: false`),跑测试 / 迁移前 `set -a; source apps/web/.env.local; set +a`;`TEST_DATABASE_URL` 指向的库会被清空。
- git commit 信息英文,结尾 `Co-Authored-By: Claude Code <noreply@anthropic.com>`。

## Review Focus

- **空数据 / 新用户**:所有趋势为 0 桶、按时率分母 0 → 渲染「—」与全 0 柱,不得 NaN / 除零 / 空数组崩溃(Task 2 `getPersonalSpaceAnalysis` 空库用例;Task 4 组件对 `ratePercent: null` 渲染「—」)。
- **`range=90` 周分桶跨月 / 跨年,末桶不满一周**:桶数 = `floor(daysBetween(bucketStart, today)/7)+1`,标签取桶起点 MM-DD(Task 1 `trendBuckets` 用例,含 10 月 → 次年 1 月跨年数据)。
- **完成日时区归属**:服务器任意 TZ 下,`updated_at` 的上海日历日归属一致;`2026-10-31T23:59+08:00` 归 10-31(Task 1 `shanghaiDay` 用例,用固定 UTC 时间戳断言)。
- **僵尸任务边界**:`updated_at` 恰为 `today-14` 当天(上海零点之后任意时刻)不算僵尸,更早才算(Task 3 用例,两个相差一天的时间戳)。
- **无截止日期的已完成任务**不进按时率分母(Task 2 用例,混合有 / 无截止的 done 任务断言分母)。

---

### Task 1: 纯函数分桶模块 `buckets.ts`

**Files:**
- Create: `apps/web/src/features/analysis/buckets.ts`
- Test: `apps/web/src/features/analysis/buckets.test.ts`

**Interfaces:**
- Consumes: `addDays`、`daysBetween`、`getWeekStart`(`@open-doing/types` 与 `@/lib/today`,均为既有导出)。
- Produces(Task 2/3/4 依赖,签名冻结):
  - `export type AnalysisRange = 7 | 30 | 90;`
  - `export function parseAnalysisRange(param: string | string[] | undefined): AnalysisRange;` — 合法 `"7"|"30"|"90"` 返回对应值,其余(含 undefined / 数组 / 带空格)返回 30。
  - `export interface TrendBucket { label: string; start: string; end: string; }`(YYYY-MM-DD,含端点;`label` 为 `MM-DD`)。
  - `export function rangeWindow(today: string, range: AnalysisRange): { start: string; end: string };` — 闭区间 `[addDays(today, -(range-1)), today]`。
  - `export function trendBuckets(today: string, range: AnalysisRange): TrendBucket[];` — 7/30 → 逐日 N 桶;90 → 7 天周桶,首桶起点 = `getWeekStart(rangeWindow.start)`,桶数 = `floor(daysBetween(首桶起点, today)/7)+1`,末桶 `end` 截到 `today`。
  - `export function futureDueBuckets(today: string): TrendBucket[];` — 14 个逐日桶,`[today, addDays(today, 13)]`。
  - `export function recentWeekBuckets(today: string, count: number): TrendBucket[];` — `count` 个周桶,末桶为本自然周(`getWeekStart(today)` 起 7 天),向前推;用于项目健康度「近 6 周」(调用方传 6)。
  - `export function bucketIndexForDay(buckets: TrendBucket[], day: string): number;` — 命中返回下标,否则 -1(线性查找即可)。
  - `export function shanghaiDay(value: Date): string;` — `Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai" })` 得 `YYYY-MM-DD`(沿 `todayInShanghai` 的实现手法)。

- [ ] **Step 1: 写失败测试** `buckets.test.ts`,至少覆盖:
  - `parseAnalysisRange`:7 个合法外输入(undefined / `"abc"` / `["30"]` / `"30 "` / `""` / `"0"` / `"300"`)全为 30;`"7"|"30"|"90"` 全命中。
  - `rangeWindow(today="2026-10-30", 30)` → start `"2026-10-01"`、end `"2026-10-30"`;`rangeWindow("2026-10-30", 7)` → `"2026-10-24"`。
  - `trendBuckets("2026-10-30", 30)` → 30 桶逐日、首桶 `{label:"10-01", start:"2026-10-01", end:"2026-10-01"}`;`trendBuckets(_, 7)` → 7 桶。
  - `trendBuckets("2027-01-05", 90)` → 周桶跨年:首桶起点为 `getWeekStart("2026-10-07")`,末桶 end `"2027-01-05"`,桶数 = `floor(daysBetween(首桶起点,"2027-01-05")/7)+1`,相邻桶 start 连续(`addDays(前桶.start, 7) === 后桶.start`)。
  - `futureDueBuckets("2026-10-30")` → 14 桶,首 `{start:"2026-10-30"}`,末 end `"2026-11-12"`(跨月)。
  - `recentWeekBuckets("2026-10-30", 6)` → 6 桶,末桶 start `"2026-10-26"`(周一),首桶 start `"2026-09-21"`,相邻差 7 天。
  - `bucketIndexForDay`:命中首 / 中 / 尾桶,未命中(早于首桶 / 晚于末桶 / 桶间空隙日)返回 -1。
  - `shanghaiDay(new Date("2026-10-31T15:59:00Z"))` → `"2026-10-31"`(UTC 15:59 = 上海 23:59);`new Date("2026-10-31T16:01:00Z")` → `"2026-11-01"`(上海零点翻转)。
- [ ] **Step 2: 跑测试确认失败** — `set -a; source apps/web/.env.local; set +a; pnpm vitest run apps/web/src/features/analysis/buckets.test.ts`,预期 FAIL(模块不存在)。
- [ ] **Step 3: 实现 `buckets.ts`**(按上述签名;分桶纯日历算术,复用 `addDays`/`daysBetween`/`getWeekStart`,不引入 dayjs)。
- [ ] **Step 4: 跑测试通过**(同 Step 2 命令,预期 PASS;本文件不依赖 DB,也可整文件跑)。
- [ ] **Step 5: Commit** — `feat(analysis): add pure range and bucket helpers`

### Task 2: 个人空间 Analysis service

**Files:**
- Create: `apps/web/src/features/analysis/service.ts`(本任务只写个人部分;团队部分留 Task 3 追加)
- Test: `apps/web/src/features/analysis/service.test.ts`

**Interfaces:**
- Consumes: Task 1 全部导出;`tasks`/`projects`(`@/server/db/schema`);`db, type DbClient`(`@/server/db/client`);`todayInShanghai` 不在此用(today 由入参传)。
- Produces(签名与 DTO 冻结,Task 4 消费):
  - `export interface OnTimeStats { denominator: number; onTime: number; ratePercent: number | null; }`
  - `export interface PersonalAnalysisStats { inProgress: number; doneThisMonth: number; overdue: number; onTime: OnTimeStats; }`
  - `export interface AnalysisTrendPoint { label: string; count: number; }`
  - `export interface CreatedCompletedPoint { label: string; created: number; completed: number; }`
  - `export interface ProjectComparisonRow { projectId: string | null; projectName: string; doneCount: number; }`
  - `export interface PersonalSpaceAnalysis { stats: PersonalAnalysisStats; completionTrend: AnalysisTrendPoint[]; createdVsCompleted: CreatedCompletedPoint[]; futureDue: AnalysisTrendPoint[]; projectComparison: ProjectComparisonRow[]; }`
  - `export async function getPersonalSpaceAnalysis(userId: string, range: AnalysisRange, today: string, client: DbClient = db): Promise<PersonalSpaceAnalysis>;`

语义(全部钉死):
- 范围谓词恒为 `eq(tasks.assigneeId, userId)`(两 spaceType 都算;不 join 权限表)。
- `stats`:一条 `count(*) FILTER (WHERE ...)` 聚合(沿 `getMyTaskStats` 写法)——`inProgress` = status `in_progress`;`doneThisMonth` = done 且上海完成日 ≥ `today.slice(0,7)+"-01"`;`overdue` = 未完成且 `dueDate < today`;`onTime.denominator` = done 且 `dueDate` 非空且上海完成日 ∈ `[addDays(today,-29), today]`(固定 30 天,与 range 无关);`onTime.onTime` = 分母条件且 `完成日 <= dueDate`;`ratePercent` = 分母 0 → `null`,否则 `Math.round(onTime/denominator*100)`。
- 上海完成日 / 创建日在 SQL 侧物化为日期字符串再进 TS 分桶:`(tasks.updatedAt AT TIME ZONE 'Asia/Shanghai')::date::text` 与 `(tasks.createdAt ...)` 同式(别名 `completedDay` / `createdDay`)。
- `completionTrend`:done 且完成日 ∈ `rangeWindow(range)` 的行,按 `trendBuckets` 分桶;返回**每个桶一个点**(含 0),`label` 取桶。
- `createdVsCompleted`:同窗口,created 按 `createdDay`、completed 按 `completedDay` 分桶;逐桶 `{label, created, completed}`。
- `futureDue`:未完成且 `dueDate ∈ [today, today+13]`,按 `futureDueBuckets` 分桶,逐桶计数。
- `projectComparison`:done 且完成日 ∈ range 窗口,`groupBy projectId` 计数(`LEFT JOIN projects` 取名,无项目 `projectName: ""`);`doneCount` 降序、`projectName` 升序平局;只返回 `doneCount > 0` 的项目。
- 查询并行(`Promise.all`,沿 calendar service 风格);排序在 TS 侧不必,桶序天然固定。

- [ ] **Step 1: 写失败测试** `service.test.ts`(沿 `features/calendar/service.test.ts` 的基建:`testing.ts` 重放迁移 + TRUNCATE、显式注入 client、fixture 用 helper 建用户/项目/任务)。至少:
  - **空库**:无任何任务 → `stats` 全 0、`onTime.ratePercent === null`、trend 各桶 count 0(桶数正确:range 30 → 30 点)、`projectComparison: []`。
  - **完成趋势归属**:一条 done 任务 `updated_at = 上海 2026-10-15 任意时刻` → 落 10-15 桶;`range=7`(窗口 10-24..10-30)时不出现。
  - **createdVsCompleted**:同一天既有 created 又有 done 的桶两点都计数;只创建未完成的进 `created`。
  - **按时率**:造 3 条有截止的 done(2 条完成日 ≤ 截止日、1 条完成日 > 截止日)+ 1 条无截止的 done → `denominator === 3`、`onTime === 2`、`ratePercent === 67`;全删有截止任务后(另一空库场景或重新 TRUNCATE)分母 0 → `ratePercent === null`。
  - **overdue**:未完成 `dueDate = today-1` 计入,`dueDate = today` 不计入;done 的过期任务不计入。
  - **futureDue**:未完成 `dueDate = today` 与 `today+13` 计入首 / 末桶;`today+14` 不出现;done 的未来任务不计入。
  - **projectComparison**:两个项目各若干 done + 只属于其一的计数;doneCount 排序;无项目任务的 `projectName === ""`;他人任务(assigneeId 另一人)不计入。
- [ ] **Step 2: 跑测试确认失败**(同 Task 1 环境命令;预期 FAIL)。
- [ ] **Step 3: 实现 `getPersonalSpaceAnalysis`**。
- [ ] **Step 4: 跑测试通过**。
- [ ] **Step 5: Commit** — `feat(analysis): personal space analysis service`

### Task 3: 团队空间 Analysis service

**Files:**
- Modify: `apps/web/src/features/analysis/service.ts`(追加团队部分)
- Test: `apps/web/src/features/analysis/service.test.ts`(追加用例)

**Interfaces:**
- Consumes: Task 1/2 导出;`getTeamOverview`(`@/features/dashboard/team-overview/service`,既有导出,签名 `getTeamOverview(input: { teamId: string; teamSlug: string; today: string }, client?)`,返回 `TeamOverview` 含 `projects[]`、`members[]`、`teamStats { projectCount, avgProgress, dueSoonCount, overdueCount }`);`getWeekStart`、`daysBetween`;`teamScope`(`@/features/kanban/service`)。
- Produces(Task 4 消费):
  - `export interface ZombieTaskItem { id: string; title: string; projectName: string; assigneeName: string | null; stalledDays: number; }`
  - `export interface TeamAnalysisStats { projectCount: number; avgProgressPercent: number; overdue: number; doneThisWeek: number; }`(`avgProgressPercent = Math.round(avgProgress*100)`)
  - `export interface ProjectHealthRow { projectId: string; projectName: string; progressPercent: number; hasOverdue: boolean; hasDueSoon: boolean; taskCount: number; doneCount: number; weeklyDone: number[]; }`(`weeklyDone` 恒长 6,对应 `recentWeekBuckets(today, 6)`)
  - `export interface TeamMemberLoadRow { userId: string; username: string; inProgress: number; dueSoon: number; overdue: number; }`
  - `export interface TeamSpaceAnalysis { stats: TeamAnalysisStats; throughput: AnalysisTrendPoint[]; members: TeamMemberLoadRow[]; projectHealth: ProjectHealthRow[]; zombieTasks: ZombieTaskItem[]; }`
  - `export async function getTeamSpaceAnalysis(input: { teamId: string; teamSlug: string; range: AnalysisRange; today: string }, client: DbClient = db): Promise<TeamSpaceAnalysis>;`(`teamSlug` 仅透传给 `getTeamOverview`,页面已持有)

语义:
- 调 `getTeamOverview({ teamId, teamSlug, today }, client)` 取快照:`stats.projectCount/avgProgress/overdue` 来自 `teamStats`;`members` 逐行裁成 `TeamMemberLoadRow`(丢弃 `tasks/href`);`projectHealth` 基础来自 `overview.projects`(`progressPercent = Math.round(progress*100)`;`teamSlug` 由页面传入)。
- `doneThisWeek`:自建一条 count——`teamScope(teamId)` + done + `tasks.updatedAt >= getWeekStart(today) 的上海零点 timestamptz`(SQL 式 `(tasks.updatedAt AT TIME ZONE 'Asia/Shanghai') >= ${weekStart}::timestamp`,沿 `getMyTaskStats` 注释口径)。
- `throughput`:done 团队任务完成日 ∈ range 窗口,`trendBuckets` 分桶(与个人 completionTrend 同法,scope 换 `teamScope`)。
- `projectHealth.doneCount` + `weeklyDone`:一条查询——团队 done 任务上海完成日 ≥ `recentWeekBuckets[0].start`,select `projectId, completedDay`;TS 侧按项目聚合计数与 6 周分桶;`overview.projects` 顺序保持,`weeklyDone` 不足补 0。
- `zombieTasks`:`teamScope` + `status = 'in_progress'` + `tasks.updatedAt < (${addDays(today, -14)}::timestamp AT TIME ZONE 'Asia/Shanghai')`,`INNER JOIN projects`、`LEFT JOIN users` 取名;`stalledDays = daysBetween(上海完成更新日, today)`;排序 `updatedAt asc`(最久在前)取前 10。
- 语义注记(写进 JSDoc,测试不覆盖):删除任务造成的趋势重建失真是已知边界(§M5 数据口径)。

- [ ] **Step 1: 追加失败测试**(fixture 同文件既有 helper 建 team/project/membership):
  - **快照映射**:3 项目各若干任务(含子任务影响 progress 的场景可简化——直接断言 `avgProgressPercent === Math.round(overview 值)`)→ `stats.projectCount === 3`;`members` 行数与 `inProgress` 计数与 overview 一致;`projectHealth` 顺序与 overview.projects 一致、`hasOverdue/hasDueSoon` 透传、`weeklyDone.length === 6`。
  - **doneThisWeek**:本周一(上海)更新的 done 计入;上周更新的 done 不计入。
  - **throughput**:跨 range 窗口边界的 done 归属正确;`range=90` 返回周桶(桶数与 Task 1 公式一致)。
  - **weeklyDone**:项目 A 在本周完成 2、上周完成 1 → `weeklyDone[5] === 2`、`weeklyDone[4] === 1`(末桶下标 5),他周为 0;项目 B 无完成全 0。
  - **僵尸任务**:in_progress 且 `updated_at = today-15 上海零点前` → 出现且 `stalledDays === 15`;`updated_at = today-14 当天 00:05 上海` → **不**出现;done / todo 的老任务不出现;超过 10 条截断为 10;`assigneeName` 未指派为 null。
  - **吞吐口径**:未指派的团队 done 任务计入 throughput(teamScope 不看 assignee)。
- [ ] **Step 2: 跑测试确认失败**。
- [ ] **Step 3: 实现团队部分**。
- [ ] **Step 4: 跑测试通过**(整文件,含 Task 2 用例)。
- [ ] **Step 5: Commit** — `feat(analysis): team space analysis service`

### Task 4: 组件与页面(variant 渲染 + range 交互 + 占位页退役)

**Files:**
- Create: `apps/web/src/features/analysis/components/charts.tsx`(server 可渲染的纯展示件,无 "use client")
- Create: `apps/web/src/features/analysis/components/AnalysisRangeSelector.tsx`("use client")
- Create: `apps/web/src/features/analysis/components/SpaceAnalysis.tsx`(server 组件,variant 分支)
- Create: `apps/web/src/app/(dashboard)/space/personal/analysis/page.tsx`
- Create: `apps/web/src/app/(dashboard)/space/[teamSlug]/analysis/page.tsx`
- Delete: `apps/web/src/app/(dashboard)/space/[teamSlug]/[module]/page.tsx`

**Interfaces:**
- Consumes: Task 2/3 全部 DTO;Task 1 `parseAnalysisRange`/`AnalysisRange`;`StatCard`(`@/components/ui/StatCard`,props `{label, value, hint?, color?}`);`moduleHref(spaceRef, "analysis")`、`personalTaskHref`/`teamTaskHref` 如需链接;`requireUser`、`getTeamBySlug`/`getMembership`(团队页 404 语义,沿 team calendar page 逐行同款,含 `generateMetadata` 非成员不泄露团队名)。
- Produces:
  - `charts.tsx`:
    - `export interface TrendSeries { tone: "primary" | "teal"; values: number[]; }`(`primary` = 品牌紫 `#7d2ae8` = `var(--color-primary)`,`teal` = `#0e9ba3`)
    - `export function TrendChart(props: { buckets: TrendBucket[]; series: TrendSeries[]; unit?: number /* px/值,默认 36 */; yMax?: number /* 缺省取 series 最大值 */; }): JSX.Element` — 结构对照原型 `.vz-*`:左侧 y 轴刻度列(0..yMax 每 1 个 unit 一条?——**网格线只画偶数刻度**:0、2、4…,与原型一致)、hairline 网格线(`1px var(--color-border)`,基线 `var(--color-border-strong)`)、逐桶列(单系列 1 柱 / 双系列并排 2 柱,柱宽 9px、圆角顶 4px、0 值空列)、峰值与最后一根直接标数(`<em>` 悬于柱顶)、x 轴标签每 5 桶 + 末桶(单行 nowrap)、每列 `title="MM-DD · 完成 N"` 形如原型的原生悬停说明(双系列 `· 新增 N / 完成 N`)。
    - `export function HBarList(props: { rows: { key: string; name: string; sub?: string; tag?: string; count: number; max: number; }[]; }): JSX.Element` — 横向条(高 14px、左端方角右端 4px 圆角、`var(--color-primary)`、宽 = count/max%),行尾 `count` 数值;`sub` 为次行说明(成员负载的逾期 / 临期注记),`tag` 渲染既有 `.tag` 等价 Tailwind 样式(对照原型的「团队」tag)。
    - `export function WeekMiniBars(props: { values: number[]; title?: string; }): JSX.Element` — 6 根 6px 宽迷你柱(高 = 值×4px,0 值跳过),`title` 全量说明。
  - `AnalysisRangeSelector.tsx`:`export function AnalysisRangeSelector(props: { basePath: string; range: AnalysisRange; }): JSX.Element` — 三个按钮「近 7 天 / 近 30 天 / 近 90 天」(antd `Segmented` 也可,但为免 client 包重、用与原型 `.seg` 同构的按钮组),active 态高亮当前 range;点击 `router.push(\`${basePath}?range=${n}\`)`。
  - `SpaceAnalysis.tsx`:`export function SpaceAnalysis(props: { variant: "personal" | "team"; range: AnalysisRange; today: string; basePath: string; personal: PersonalSpaceAnalysis | null; team: TeamSpaceAnalysis | null; }): JSX.Element` — 互斥入参(variant 决定读哪个);结构:
    - 页头下右侧 `<AnalysisRangeSelector>`;统计行用 4 张 `StatCard`:personal(进行中 / 本月完成 / 当前逾期 / 按时率,ratePercent null → 值「—」)、team(在册项目 / 团队整体进度`%` / 当前逾期 / 本周完成);颜色对照原型(成功绿 / 错误红 / 品牌紫)。
    - personal 区块顺序:完成趋势(单系列)→ 新增 vs 完成(双系列 + 图例「新增」teal /「完成」primary)与 未来截止分布 双列(`grid grid-cols-1 min-[861px]:grid-cols-2`,后者卡尾带原型同款 info callout「含个人与指派给你的团队任务;逾期任务不计入未来分布…」)→ 项目对比(HBarList)。
    - team 区块顺序:吞吐(单系列)→ 成员负载分布(HBarList,avatar 省略,`sub` 带逾期 / 临期注记;卡尾 callout「未指派任务 N 项 · 前往 Kanban 指派」——未指派数 overview 未提供,可从 `getTeamOverview` 不可得则**省略该 callout**,此为定稿偏差记录)与 项目健康度 双列(每项目:名称 + 任务计数 caption + tag(已逾期 / 临期 / 正常)+ 进度条(复用原型 is-error/is-warning/is-success 配色)+ `WeekMiniBars` 近 6 周)→ 僵尸任务(列表行:标题 + `项目 · 责任人 · 最后更新 MM-DD,已停留 N 天` + 右侧「停留 N 天」tag;卡尾链接「处理或关闭这些任务 · 前往 Kanban →」指向 `moduleHref(spaceRef, "kanban)")`)。
    - 页尾口径 callout:照抄两份原型底部文案(「口径说明:完成日按任务最近一次状态更新时间近似…」;团队版含成员负载重建与僵尸定义句)。
  - 页面:personal page 解析 `searchParams.range` → `parseAnalysisRange`,`getPersonalSpaceAnalysis(user.id, range, today)`,标题「Analysis · Open Doing」,页头文案照原型;team page 沿 team calendar page 的 404 / metadata 模式,`Promise.all([getTeamSpaceAnalysis(...)])` 后渲染;`basePath = moduleHref(spaceRef, "analysis")`。
  - **占位页退役**:`MODULE_LABELS` 清空后删除 `[module]/page.tsx` 整个文件(`EmptyState` 组件仍被他处使用,只删页面)。此后未知模块由 Next 路由自然 404,行为不变。

- [ ] **Step 1: 实现三个组件 + 两个页面,删除占位页**(样式对照原型逐卡核对;服务端组件不得 import service 以外的 DB 触点——DTO 已序列化,直接消费)。
- [ ] **Step 2: 类型检查 + 构建验证** — `pnpm --filter @open-doing/web exec next typegen && pnpm typecheck && pnpm lint`,预期全绿;`pnpm build` 成功(确认删除占位页后无悬空 import)。
- [ ] **Step 3: 手工冒烟**(可选但推荐):`pnpm dev` + `pnpm db:seed` 后访问两页截图与原型对照;关注空库时「—」与 0 柱。
- [ ] **Step 4: Commit** — `feat(analysis): space analysis pages with self-drawn charts`

### Task 5: e2e 流 + 文档回填

**Files:**
- Create: `apps/web/e2e/flows/08-space-analysis.spec.ts`
- Modify: `docs/V1.1_TASKS.md`(§M5 追加「实现记录」)

**Interfaces:**
- Consumes: Task 4 的两条真实路由;`flows/06`/`flows/07` 的既有引导 helper(登录、建队、成员)。
- Produces: e2e 全绿的完整里程碑;文档回填格式沿 §M4「实现记录」。

- [ ] **Step 1: 写 e2e**(沿 `flows/07-space-calendar.spec.ts` 结构与日期口径,`shanghaiToday()` 相对构造;**不得与 vitest 并行跑**)。用例:
  1. 已登录访问 `/space/personal/analysis`:统计行四个 label(进行中 / 本月完成 / 当前逾期 / 按时率)与四个区块标题(完成趋势 / 新增 vs 完成 / 未来截止分布 / 项目对比)可见;默认「近 30 天」高亮。
  2. 点「近 7 天」→ URL 含 `range=7`,页面仍渲染统计行(快照不变性:统计行文案不因 range 改变)。
  3. 直接访问 `/space/personal/analysis?range=abc` → 「近 30 天」高亮(宽容回退)。
  4. 团队成员访问 `/space/{teamSlug}/analysis`:吞吐 / 成员负载分布 / 项目健康度 / 僵尸任务标题可见。
  5. 非成员(或未登录)访问该 URL → 404 语义(沿 flow 07 的断言方式)。
  - 僵尸任务可见性若 flow 引导能低成本造出 `in_progress` 老任务(直接走 UI 建 + 不现实改时间)则断言列表出现;成本高则用例 4 只断言区块标题,不为它造专用 fixture。
- [ ] **Step 2: 跑 e2e** — `pnpm --filter @open-doing/web test:e2e -- flows/08-space-analysis.spec.ts`,预期 PASS。
- [ ] **Step 3: 全量验证** — `pnpm vitest run`(全绿,串行)+ `pnpm --filter @open-doing/web test:e2e`(全绿,带 db-guard 脚本)+ `pnpm lint && pnpm typecheck && pnpm build`。
- [ ] **Step 4: 回填 `docs/V1.1_TASKS.md` §M5 实现记录**:路由契约(personal/team page 的 range 解析)、两条及以上裁定(见下)、service/component/test/e2e 摘要、已知边界(删除任务重建失真;未指派 callout 若省略记录定稿偏差;按时率固定 30 天窗口与原型一致)。
- [ ] **Step 5: Commit** — `test(e2e): add space analysis flow and finalize M5 docs`

## 执行期裁定预案(控制器按此裁决,不另等待)

- **原型与定稿冲突处,以原型为准**(M3/M4 先例),偏差逐条记入实现记录。
- **占位页退役**:本计划显式删除 `[module]/page.tsx`(§M5「实现时定」的落地决定);若审查发现他处仍链接占位路由(grep `moduleHref.*analysis` 之外的占位引用),修链接而不是恢复占位页。
- **未指派 callout**:`getTeamOverview` 不返回未指派计数;为避免为一句文案扩查询,团队成员负载卡尾 callout 省略(偏差记录),成员负载页脚留 Kanban 指引由僵尸任务卡承担。
- **团队页不引入 `getTeamOverview` 重构**:复用其返回值,不改动 dashboard 模块(避免跨里程碑 churn)。
