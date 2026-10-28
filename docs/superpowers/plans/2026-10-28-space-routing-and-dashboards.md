# M2:统一空间路由 + 新侧栏 IA + 双 Dashboard 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 落地 M1/§M2 已定决策——全站迁移到统一空间树 `/space/{spaceRef}/{module}`(旧 URL 重定向)、侧栏换为「空间切换器 + 五模块」新 IA(含移动端 Drawer)、个人/团队 Dashboard 按已审核原型 `docs/prototypes/space-dashboard-personal.html` / `space-dashboard-team.html` 实现。

**Architecture:** 纯函数 URL builder(`lib/routes.ts`)先冻结所有 href 拼装;路由目录 `git mv` 到新树 + `next.config.ts` redirects 兜旧链接;侧栏改为单一 `SpaceNav`(server 取数)与 `SpaceNavMenu`(client,`usePathname` 推导当前空间与模块高亮),AppShell 契约由 personalNav/teamsNav 双槽改为 nav/mobileNav;两个 Dashboard 页为 RSC 取数 + client 交互件(今天列表勾选走现有 `updatePersonalTaskAction` / `updateTeamTaskAction`)。

**Tech Stack:** Next.js 16 App Router(React 19、typed routes)、antd v6、Tailwind 4(preflight 关闭)、Drizzle + PostgreSQL、Vitest(串行)。

**Spec:**
- `docs/V1.1_TASKS.md` §M1(路由/导航/矩阵已定)+ §M2(Dashboard 已定)
- 原型(视觉与文案对照基准):`docs/prototypes/space-dashboard-personal.html`、`docs/prototypes/space-dashboard-team.html`(侧栏即 v1.1 新 IA 实样)

## Global Constraints

- 全站中文文案;日期口径 Asia/Shanghai,`today` 由 RSC 用 `todayInShanghai()` 取出后作为 prop 下传,组件内不得自行取当前日期。
- Server Action 返回 `ActionResult<T>`;本计划不新增 Action,勾选完成复用现有 `updatePersonalTaskAction(taskId, { status })` 与 `updateTeamTaskAction(taskId, { teamId, status })`。
- 不新建 ConfigProvider;antd 交互组件只在 `"use client"` 组件中;Tailwind 不覆盖 antd 内部样式;品牌色 `#7d2ae8`,语义色 success `#00b894` / warning `#ffb020`(临期文字用 `#a66b00`)/ error `#ff5757`。
- vitest 串行、DB 测试前 `set -a; source apps/web/.env.local; set +a`;干净 checkout 先 `pnpm --filter @open-doing/web exec next typegen` 再 `pnpm typecheck`。
- commit message 英文,结尾 `Co-Authored-By: Claude Code <noreply@anthropic.com>`。
- 不做:M3 Kanban / M4 Calendar / M5 Analysis / M6 个人设置的实质功能(本计划只留模块占位页);不引入新依赖;不改任务权限模型。

## Review Focus

1. **团队 slug 撞保留字**:slug 为 `personal` 的团队会与静态段 `/space/personal` 冲突,slug 为 `new`/`join` 的团队会被重定向正则排除——v1.1 接受此风险(X1 做保留字封锁),但重定向规则必须保证 `new`/`join` 不被错误重定向(有测试)。
2. **「今天」边界**:`due_date = 今天` 必须进今天列表,`明天`与已完成任务必须排除;逾期任务排在今天之前且按截止日期升序(有 DB 测试)。
3. **20 条封顶与总数**:超过 20 条时只渲染 20 条,页尾链接计数用 SQL 全量 count 而非数组长度(有 DB 测试)。
4. **旧链接不断**:任意 `/my/*`、`/teams/{slug}/*` 深链(含 query)经重定向到达等价新页;`/teams/new`、`/teams/join` 不被重定向(重定向配置 + e2e 断言)。
5. **移动端可达性**:<861px 时侧栏隐藏,汉堡 Drawer 必须能到达桌面侧栏的每一个入口(空间切换、五模块、待处理邀请);Drawer 开启时页面背景不滚动错位由 antd 默认行为保证,不做自定义。

---

### Task 1: URL builder `lib/routes.ts`

**Files:**
- Create: `apps/web/src/lib/routes.ts`
- Test: `apps/web/src/lib/routes.test.ts`

**Interfaces:**
- Produces(后续所有任务消费,全站 href 唯一出口):

```ts
export type SpaceRef = string; // "personal" 或团队 slug
export type SpaceModule = "dashboard" | "kanban" | "calendar" | "analysis" | "settings";

export function spaceDashboardHref(spaceRef: SpaceRef): string; // `/space/${spaceRef}/dashboard`
export function moduleHref(spaceRef: SpaceRef, module: SpaceModule): string; // `/space/${spaceRef}/${module}`
export function personalTaskHref(taskId: string): string; // `/space/personal/tasks/${taskId}`
export function personalProjectHref(projectSlug: string): string; // `/space/personal/projects/${projectSlug}`
export function teamTaskHref(teamSlug: string, projectSlug: string, taskId: string): string;
export function teamProjectHref(teamSlug: string, projectSlug: string): string;
export function teamProjectNewHref(teamSlug: string): string; // `/space/${teamSlug}/projects/new`
export function teamSettingsHref(teamSlug: string): string;
export function invitesHref(): string; // `/invites`
export function createTeamHref(): string; // `/teams/new`
export function joinTeamHref(): string; // `/teams/join`
```

- [ ] **Step 1: 写失败测试** `routes.test.ts`:每个函数至少 1 例,断言精确字符串,如 `expect(teamTaskHref("growth", "site", "t1")).toBe("/space/growth/projects/site/tasks/t1")`;`moduleHref("personal", "kanban")` → `/space/personal/kanban`。
- [ ] **Step 2: 跑测试确认失败** `pnpm vitest run apps/web/src/lib/routes.test.ts` → FAIL(模块不存在)。
- [ ] **Step 3: 实现** `lib/routes.ts`(纯模板字符串拼接,无依赖)。
- [ ] **Step 4: 跑测试确认通过**(同 Step 2 命令)。
- [ ] **Step 5: Commit** `feat(web): add space route url builders`

### Task 2: 路由迁移 + 重定向

**Files:**
- Move: `app/(dashboard)/my/page.tsx` → `app/(dashboard)/space/personal/dashboard/page.tsx`(内容本任务不动,Task 7 重写)
- Move: `app/(dashboard)/my/tasks/[taskId]/page.tsx` → `app/(dashboard)/space/personal/tasks/[taskId]/page.tsx`
- Move: `app/(dashboard)/my/projects/[projectSlug]/page.tsx` → `app/(dashboard)/space/personal/projects/[projectSlug]/page.tsx`
- Move: `app/(dashboard)/teams/[teamSlug]/` 整棵 → `app/(dashboard)/space/[teamSlug]/`(page、settings、projects/new、projects/[projectSlug]、projects/[projectSlug]/tasks/[taskId])
- 保留原位: `app/(dashboard)/teams/new/`、`app/(dashboard)/teams/join/`
- Modify: `app/(dashboard)/page.tsx`、`next.config.ts`、各移动页的 `PageProps<"/teams/[teamSlug]">` 等类型引用、移动后页内相对链接与 `revalidatePath`/`router.push` 中的旧路径字符串(文件内自洽即可,全站清扫在 Task 3)

**Interfaces:**
- Consumes: Task 1 的 builder(移动页内自引用路径改用 builder)。
- Produces: 新路由树生效;旧 URL 由重定向兜底。

- [ ] **Step 1: `git mv` 目录**(保持 git 历史);`space/personal/page.tsx` 落位为 `space/personal/dashboard/page.tsx`。
- [ ] **Step 2: `next.config.ts` 增加 `redirects()`**(顺序敏感,`permanent: false`):

```ts
async redirects() {
  return [
    { source: "/my", destination: "/space/personal/dashboard", permanent: false },
    { source: "/my/:path*", destination: "/space/personal/:path*", permanent: false },
    // 负向前瞻排除静态页,避免 /teams/new、/teams/join 被当团队 slug 重定向
    { source: "/teams/:slug(?!new|join)", destination: "/space/:slug/dashboard", permanent: false },
    { source: "/teams/:slug(?!new|join)/:path*", destination: "/space/:slug/:path*", permanent: false },
  ];
}
```

- [ ] **Step 3: 根页重定向** `(dashboard)/page.tsx` 的 `redirect("/my")` 改为 `redirect("/space/personal/dashboard")`。
- [ ] **Step 4: 修 typed routes**:`pnpm --filter @open-doing/web exec next typegen`,然后把移动页中 `PageProps<"/teams/[teamSlug]">` 等改为新路径字面量(`PageProps<"/space/[teamSlug]">` 等),并跑 `pnpm typecheck` 至绿。
- [ ] **Step 5: DB 测试基线**(此时 href 断言仍会红,属 Task 3 范围,先只跑 `pnpm vitest run apps/web/src/lib` 确认无回归)。
- [ ] **Step 6: Commit** `feat(web): move routes to unified /space tree with legacy redirects`

### Task 3: 全站 href 清扫到 builder

**Files(以 grep 实测为准,当前硬编码 39 处):**
- Modify: `features/dashboard/my-tasks/service.ts`(`buildTaskHref` 改用 `personalTaskHref`/`teamTaskHref`)、`features/dashboard/team-overview/service.ts`(风险区/成员负载/未指派 href)、`features/notifications/queries.ts`(通知跳转链接)、`components/ui/task-detail/TaskDetailView.tsx`、`features/personal/components/PersonalNavMenu.tsx`、`features/personal/projects/components/PersonalProjectHeaderActions.tsx`、`features/personal/tasks/components/ProjectTaskTable.tsx`、`features/personal/tasks/components/TaskRowActions.tsx`、`features/projects/components/TeamProjectForm.tsx`、`features/tasks/components/TeamProjectTaskTable.tsx`、`features/teams/components/CreateTeamForm.tsx`、`features/teams/members/components/DissolveTeamButton.tsx`、`features/teams/members/components/LeaveTeamButton.tsx`、`app/(dashboard)/invites/page.tsx`、`app/(dashboard)/teams/join/page.tsx`、`app/(dashboard)/teams/new/page.tsx`、`app/(auth)/layout.tsx`、`features/auth/components/LoginForm.tsx`、`features/auth/components/RegisterForm.tsx`
- Test(期望值同步): `features/dashboard/my-tasks/service.test.ts`、`features/dashboard/team-overview/service.test.ts`、`features/notifications/queries.test.ts`、`features/dashboard/my-tasks/service.test.ts` 中 href 断言

**Interfaces:**
- Consumes: Task 1 全部 builder。
- Produces: 源码中不再出现 `` ` /my/ ``、`` ` /teams/ `` 模板串(`teams/new`、`teams/join`、`/invites` 经 `createTeamHref`/`joinTeamHref`/`invitesHref` 表达)。

- [ ] **Step 1: 逐文件替换为 builder**,登录/注册成功跳转改为 `spaceDashboardHref("personal")`。
- [ ] **Step 2: 更新受影响测试期望值**(如 `href: "/space/personal/tasks/…"`、`/space/growth/projects/site/tasks/…`)。
- [ ] **Step 3: 全量验证** `set -a; source apps/web/.env.local; set +a && pnpm vitest run` 全绿;`grep -rn '`/my/\|`/teams/' apps/web/src` 仅剩 0 处(`"/teams/new"`、`"/teams/join"` 字符串经 builder 后不再存在)。
- [ ] **Step 4: Commit** `refactor(web): route all internal hrefs through lib/routes builders`

### Task 4: SpaceSwitcher 适配 /space

**Files:**
- Modify: `components/layout/SpaceSwitcher.tsx`
- Test: `components/layout/SpaceSwitcher.test.ts`

**Interfaces:**
- Produces: `selectedSpaceKey(pathname, teamSlugs)` 新语义——`/space/personal`(含子路径)→ `"personal"`;`/space/{slug}`(slug ∈ teamSlugs,含子路径)→ `slug`;`/teams/new`、`/teams/join`、`/invites` 等其余 → `null`。菜单点击目标:personal → `/space/personal/dashboard`,team → `/space/{slug}/dashboard`,create-team/join-team 不变。

- [ ] **Step 1: 改写测试**:保留边界用例风格(精确匹配 + startsWith 边界),新增 `/space/personal/tasks/t1` → `"personal"`、`/space/growth/dashboard` → `"growth"`、`/teams/new` → `null`、`/space/unknown-team` → `null`(不在 teamSlugs)。
- [ ] **Step 2: 跑测试确认失败**。
- [ ] **Step 3: 实现**:`selectedSpaceKey` 解析 `/space/` 前缀;`handleMenuClick` 目标改 `/space/...`(用 Task 1 builder,client 组件可直接 import 纯函数)。
- [ ] **Step 4: 跑测试确认通过** `pnpm vitest run apps/web/src/components/layout/SpaceSwitcher.test.ts`。
- [ ] **Step 5: Commit** `feat(layout): adapt space switcher selection to /space routes`

### Task 5: 新侧栏 IA(SpaceNav)+ 模块占位页 + 契约变更

**Files:**
- Create: `components/layout/SpaceNav.tsx`(server:取用户、`listTeamsForUser`、`listReceivedInvites` pending 数,渲染 SpaceNavMenu)
- Create: `components/layout/SpaceNavMenu.tsx`(`"use client"`:`usePathname` 解析 `/space/{ref}/{module}` 推导当前空间与高亮;渲染五模块 + 「账号/待处理邀请」分组;未登录数据为空时由父级短路)
- Create: `components/layout/SpaceNavData.ts`(类型 `SpaceNavData { teams: {slug,name}[]; pendingInviteCount: number; loggedIn: boolean }` 与共享取数函数 `getSpaceNavData()`,供布局一次取数、Sidebar 与移动 Drawer 共用)
- Create: `app/(dashboard)/space/[teamSlug]/[module]/page.tsx`(占位页;动态段名必须是 `teamSlug`——Next 禁止同层级混用 `[spaceRef]` 与既有 `[teamSlug]`,段值在页面内按 spaceRef 语义处理)
- Modify: `components/layout/AppShell.tsx`(props 改为 `nav: ReactNode; mobileNav: ReactNode; user: User | null; children`)、`app/(dashboard)/layout.tsx`(改 import `SpaceNav`/`MobileNav`,一次 `getSpaceNavData()` 分发)、`components/layout/Sidebar.tsx`(brand 链接 → `spaceDashboardHref("personal")`;`personalNav`/`teamsNav` 双槽改单槽 `nav`)
- Delete: `features/personal/components/PersonalNav.tsx`、`features/personal/components/PersonalNavMenu.tsx`、`features/teams/components/TeamsNav.tsx`(`TeamsNavItem.tsx` 若 grep 无其他引用一并删,`NavSection.tsx` 同理)
- Modify: `docs/V1_TASKS.md` F-5 契约条目(AppShell props 与 layout 导入关系按本任务更新,注明 v1.1 M2 变更)

**Interfaces:**
- Consumes: Task 1 `moduleHref` 等 builder。
- Produces:
  - `getSpaceNavData(): Promise<SpaceNavData>`(Task 6 移动端消费)
  - `SpaceNavMenu` props: `{ data: SpaceNavData }`;模块清单固定为 Dashboard/Kanban/Calendar/Analysis/设置,href = `moduleHref(spaceRef, module)`,spaceRef 取当前路由的 `/space/` 段,非空间路由(如 `/invites`)回退 `personal`。

- [ ] **Step 1: 占位页**:`[module]` 仅接受 `kanban|calendar|analysis|settings`(其余 `notFound()`);`spaceRef === "personal"` 直接渲染;否则按团队 404 语义校验(`getTeamBySlug` + `getMembership`,不存在或非成员 `notFound()`,与现团队页一致不泄露存在性)。页面内容:EmptyState 标题「{模块名}」+ 描述「该模块将在 v1.1 后续任务上线,当前可先使用 Dashboard。」模块名映射 kanban→Kanban、calendar→Calendar、analysis→Analysis、settings→设置(团队空间 settings 由静态路由优先命中真实设置页,占位页实际只服务个人 settings 与三个在建模块)。
- [ ] **Step 2: SpaceNav/SpaceNavMenu**:模块图标用内联 SVG(与原型 space-dashboard-*.html 侧栏一致);「待处理邀请」badge 仅 pendingInviteCount > 0 时渲染;当前空间高亮由 `usePathname` 段解析,模块高亮匹配第二段。
- [ ] **Step 3: AppShell/layout/Sidebar 接线**,删除三个旧桩,grep 确认无悬空引用。
- [ ] **Step 4: F-5 契约记录**(V1_TASKS.md 对应条目改为新 props/导入关系)。
- [ ] **Step 5: 验证**:`pnpm build` + `pnpm typecheck` 绿;手工核对 `/space/personal/kanban` 渲染占位页、`/space/{slug}/settings` 命中真实设置页(静态段优先)。
- [ ] **Step 6: Commit** `feat(layout): replace dual nav stubs with unified space nav and module placeholders`

### Task 6: 移动端导航 Drawer(<861px)

**Files:**
- Create: `components/layout/MobileNav.tsx`(`"use client"`:汉堡按钮(`min-[861px]:hidden`,aria-label「打开导航」)+ antd Drawer `placement="left"` `width={280}`,内容 = SpaceSwitcher + SpaceNavMenu 叠放;关闭时机:路由变化即关——用 `usePathname` 渲染期同步)
- Modify: `components/layout/AppShell.tsx`(把 `mobileNav` 传入 `Topbar`)
- Modify: `components/layout/Topbar.tsx`(props 增 `mobileNav?: ReactNode`,渲染在品牌位之前)

**Interfaces:**
- Consumes: Task 5 `getSpaceNavData()`(layout 取数)、Task 5 `SpaceNavMenu`、Task 4 `SpaceSwitcher`。
- Produces: 桌面/移动共用同一棵导航树;<861px 无导航缺口关闭。

- [ ] **Step 1: 实现 MobileNav**(Drawer 内顶部品牌行 + SpaceSwitcher + SpaceNavMenu;`open` state,`onClose`;`usePathname` 变化时渲染期同步关闭)。
- [ ] **Step 2: Topbar/AppShell 接线**,layout 中 `<AppShell mobileNav={<MobileNav data={navData} />} …>`。
- [ ] **Step 3: 验证**:`pnpm build` 绿;手工把视口调到 ≤860px 确认汉堡可见、Drawer 可达五模块/空间切换/邀请,≥861px 汉堡隐藏。
- [ ] **Step 4: Commit** `feat(layout): add mobile drawer navigation for sub-861px viewports`

### Task 7: 个人 Dashboard(`/space/personal/dashboard`)

**Files:**
- Create: `components/ui/StatCard.tsx`(从两页各自内联定义抽出;props `{ label, value, hint, color? }`)
- Modify: `features/dashboard/my-tasks/service.ts`:`MyTaskListItem` 增加 `teamId: string | null`(select 与映射同步);新增:

```ts
export interface TodayBoard {
  tasks: MyTaskListItem[]; // 未完成且 dueDate <= today,逾期在前按 dueDate asc,封顶 limit
  total: number;           // 同条件全量 count(供页尾「还有 N 项」)
}
export async function getTodayBoard(
  input: { userId: string; today: string; limit?: number }, // limit 默认 20
  client?: DbClient,
): Promise<TodayBoard>;
```

  条件:`assigneeId = userId and status <> 'done' and dueDate <= today`(个人 + 团队任务天然都被 assignee 覆盖);排序沿用 `queryTaskList` 的 `dueDate asc nulls last`——本查询无 null。
- Modify: `features/dashboard/my-tasks/service.test.ts`(新用例 + teamId 断言)
- Create: `features/dashboard/personal-dashboard/components/TodayTaskList.tsx`(`"use client"`)
- Rewrite: `app/(dashboard)/space/personal/dashboard/page.tsx`(对照原型 space-dashboard-personal.html)

**Interfaces:**
- Consumes: `getMyTaskStats({ userId, today, weekStart })`、`getWeekStart`、`listCrossSpaceProjects`(新建任务弹窗)、`updatePersonalTaskAction(taskId, { status })`、`updateTeamTaskAction(taskId, { teamId, status })`。
- Produces: `TodayTaskList` props `{ tasks: MyTaskListItem[]; today: string; total: number }`。

- [ ] **Step 1: service 失败测试**:① `dueDate = today` 的未完成任务在 `tasks` 中;② `dueDate = addDays(today, 1)` 不在;③ `status = 'done'` 且 `dueDate <= today` 不在;④ 两条逾期(10-01、10-03)+ 一条今天(10-21)时顺序为 10-01、10-03、10-21;⑤ 25 条符合条件的任务时 `tasks.length === 20` 且 `total === 25`。
- [ ] **Step 2: 跑测试确认失败**,实现 `getTodayBoard`(count 与列表各一条 SQL,count 复用同 where)。
- [ ] **Step 3: 跑测试确认通过**(env 前置见 Global Constraints)。
- [ ] **Step 4: TodayTaskList**:每行 = antd `Checkbox`(aria-label「标记完成:{title}」)+ 标题 Link(`item.href`)+ 来源标签(团队任务「团队 · {projectName}」品牌紫浅底 / 个人任务「个人 · {projectName}」薄荷浅底;无项目个人任务显示「个人」)+ 责任人「我」+ 右侧 `DueText`(`dueDate < today` 显示「截止 {date} · 已逾期 N 天」红色,`= today` 显示「今天到期」warning 色)。勾选:本地状态即时置为 done(视觉划线淡出),调对应 Action;失败回滚并 `message.error`「更新失败,请重试」;渲染期同步 props(props 变化即重置本地状态)。列表下方页脚:`total > tasks.length` 时显示「还有 {total - tasks.length} 项未完成任务(含未来截止)· 前往 Kanban 查看全部 →」链接到 `moduleHref("personal", "kanban")`。
- [ ] **Step 5: 页面重写**:页头 h1「Dashboard」+ sub「今天要做的、快到期的,以及逾期需要兜底的,都在这里;任务全景看 Kanban。」+ 操作区 `NewPersonalProjectButton` + `NewTaskButton`;4 张 `StatCard`(进行中 / 今日 / 明日到期 / 已逾期 / 本周已完成,文案与配色对照原型);`TodayTaskList` 卡片头部「今天 · {M 月 D 日} {周X}」+ 「N 逾期」「N 今天」两枚 tag(tagN 分别统计 dueDate < today 与 = today);底部 info callout:「列表只保留「今天该看的」……」(照原型文案)。`metadata.title = "Dashboard · Open Doing"`。
- [ ] **Step 6: 清理死代码**:重写后 `features/dashboard/my-tasks/components/MyTaskTable.tsx` 与 `listMyPersonalTasks`/`listMyTeamTasks`/`queryTaskList` 若 grep 无其他引用则删除(`getTodayBoard` 自带查询),`service.test.ts` 对应用例同步移除。
- [ ] **Step 7: 全量验证**:vitest 全绿 + build/typecheck 绿。
- [ ] **Step 8: Commit** `feat(dashboard): personal space dashboard with today task list`

### Task 8: 团队 Dashboard(`/space/[teamSlug]/dashboard`)

**Files:**
- Modify: `features/dashboard/team-overview/service.ts`:`TeamOverview` 增加 `milestoneTasks: MilestoneTaskItem[]`;`MilestoneTaskItem { id, title, dueDate: string, kind: "overdue" | "dueSoon" | "upcoming", assigneeName: string | null, projectName: string, href: string }`——由 `listTeamTaskSnapshots` 派生:`status <> 'done'` 且 `dueDate` 非空,按 dueDate 升序取前 10;`kind`:dueDate < today → overdue、= today 或 = tomorrow → dueSoon、否则 upcoming
- Modify: `features/dashboard/team-overview/service.test.ts`(新增 milestoneTasks 断言:排序、封顶 10、done 排除、无 dueDate 排除)
- Create: `features/dashboard/team-dashboard/components/MilestoneList.tsx`(server 即可,纯渲染;行内链接用 `item.href`)
- Rewrite: `app/(dashboard)/space/[teamSlug]/dashboard/page.tsx`(对照原型 space-dashboard-team.html;Task 2 修复轮已将团队概览页移入 dashboard/ 子目录)

**Interfaces:**
- Consumes: `getTeamOverview({ teamId, teamSlug, today })`(现签名不变,返回值增字段)、`MemberLoadList`、Task 7 `StatCard`、`moduleHref(teamSlug, "kanban")`。

- [ ] **Step 1: service 失败测试**:① dueDate 升序排列(10-16 逾期在前);② `kind` 三态判定(过去/今天/未来);③ done 与无 dueDate 任务不入列;④ 12 条符合时取前 10;⑤ `riskTasks` 字段保留不变(通知等其他消费方不受影响)。
- [ ] **Step 2: 跑测试确认失败 → 实现 → 通过**。
- [ ] **Step 3: MilestoneList**:卡片头「重要节点」+ caption「未完成任务 · 按截止日期升序」;行渲染照原型——overdue 用 ⏰ 红、dueSoon 用 ⏳ 黄、upcoming 用 📅 中性灰底;meta 行「{projectName} · {assigneeName ?? "未指派"} · 截止 {date}{ overdue 附「已逾期 N 天」}」;卡片尾部「查看全部任务 · 前往 Kanban →」链接 `moduleHref(teamSlug, "kanban")`。
- [ ] **Step 4: 页面重写**:统计卡/项目健康度/成员负载沿用现有内容与组件(StatCard 换用抽取件);风险区删除,由「重要节点」双栏右侧替代;未指派区整体替换为一行 info callout:「未指派任务 {N} 项 · 完整列表与指派引导已移至 Kanban(空间级看板)。」页头 h1「Dashboard」+ sub「项目健康度、重要节点与成员负载,数据自任务自动聚合;任务全景看 Kanban。」`metadata.title = "{team.name} Dashboard · Open Doing"`。
- [ ] **Step 5: 全量验证**:vitest 全绿 + build/typecheck 绿。
- [ ] **Step 6: Commit** `feat(dashboard): team space dashboard with milestone list`

### Task 9: e2e 更新 + 文档收尾

**Files:**
- Modify: `apps/web/e2e/flows/02-team-invite.spec.ts`、`04-cron-reminder.spec.ts`、`05-dissolve-team.spec.ts`、`apps/web/e2e/responsive.spec.ts`(所有 `/my`、`/teams/{slug}` 导航改为 `/space/...`;新增一条断言:访问 `/my` 被重定向到 `/space/personal/dashboard`,访问 `/teams/new` 仍 200)
- Modify: `docs/ARCHITECTURE.md` §5 路由结构(新路由树 + 重定向说明)、§12 现状表;`docs/prototypes/README.md` 若路由口径有出入再校对
- Modify: `docs/V1.1_TASKS.md` §M2 标 ✅,补充实现期微调记录

- [ ] **Step 1: e2e URL 全量替换**(先 `pnpm --filter @open-doing/web exec playwright install chromium` 如未装;e2e 端口 3100、独立库)。
- [ ] **Step 2: 跑全部 e2e** `pnpm --filter @open-doing/web test:e2e` 至绿。
- [ ] **Step 3: 文档更新**(ARCHITECTURE §5 写入 `/space/{spaceRef}/{module}` 树、4 条重定向、F-5 变更注记)。
- [ ] **Step 4: V1_TASKS/§M2 回填**,标 ✅。
- [ ] **Step 5: Commit** `test(e2e): update flows to /space routes and document v1.1 IA`
