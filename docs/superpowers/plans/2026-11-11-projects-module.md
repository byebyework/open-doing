# 项目模块(空间级项目列表)Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把「项目」升级为正式空间模块:侧栏新增项目入口,个人/团队空间各补一个项目列表页(卡片含进度、任务数、健康徽标)。

**Architecture:** 纯聚合查询放两个既有 projects service(复用 team-overview 的任务快照 + 子任务计数模式),健康徽标判定与「项目等权平均」下沉 `packages/types` 纯函数;页面为 RSC(权限校验 + today 注入),卡片为无状态展示组件,新建入口复用既有表单页(团队)与弹窗(个人)。

**Tech Stack:** Next.js 16 App Router(RSC)+ Drizzle/PostgreSQL 16 + next-intl(zh/en)+ vendored shadcn/ui + Vitest/Playwright。

**Spec:** `docs/superpowers/specs/2026-11-11-projects-module-design.md`(原型:`docs/prototypes/space-projects-{team,personal}.html`)

## Global Constraints

- 所有用户文案进 `apps/web/src/i18n/messages/{zh,en}.json`,`cjk-guard` / `messages-parity` 测试必须绿;提交信息用英文 Conventional Commits。
- "今天"一律由 RSC 用 `todayInShanghai()`(`@/lib/today`)计算后作为 `today: string`(`YYYY-MM-DD`)注入,组件/服务内禁止本地时区取日期。
- 逾期/临期判定必须走 `@open-doing/types` 的 `isOverdue` / `isDueSoon`(与 team-overview 同源),不得另写日期比较。
- 团队整体进度 = 各项目进度**等权平均**(空项目计 0%);**不改动** Dashboard 现有 `avgProgress`(任务级平均)——两者数值允许不同,属已知差异。
- 冻结契约不动:`AppShell`、`(dashboard)/layout.tsx` import 关系、v1.1 的 15 个原型文件、既有页面行为。
- 数据库测试需先 `set -a; source apps/web/.env.local; set +a`;`TEST_DATABASE_URL` 必须指向 open_doing_test。
- `pnpm typecheck` 前先 `pnpm --filter @open-doing/web exec next typegen`(生成路由类型)。
- 颜色只用 token 变量(`var(--error)` 等),进度条填充色走 vendored `Progress` 的 `color` prop。

## Review Focus

- **空项目(taskCount = 0)**:卡片显示 0%/「未开始」,且以 0 计入团队整体平均(不得被排除)→ Task 1 `averageProjectProgress` 测试 + Task 4 service 测试。
- **0% 但有逾期任务的项目**:徽标必须「已逾期」而非「未开始」(优先级 逾期 > 临期 > 未开始 > 正常)→ Task 1 测试。
- **临期边界**:截止为今天或明天算临期,已完成任务永远不算逾期/临期 → Task 1 + Task 4/5 测试(today 注入固定值)。
- **非成员/未知 slug 访问 `/space/{slug}/projects`**:一律 404,不泄露团队存在性 → Task 8 e2e。
- **member(非 owner/admin)**:列表页无「新建项目」入口;直调创建 action 仍 403(现有 `createTeamProject` 行为,不得削弱)→ Task 8 e2e。

---

### Task 1: types 包——`ProjectStats`、健康徽标判定、项目等权平均

**Files:**
- Create: `packages/types/src/project-health.ts`
- Modify: `packages/types/src/index.ts`(加一行 re-export,随现有 `export * from "./progress"` 风格)
- Test: `packages/types/src/project-health.test.ts`

**Interfaces:**
- Consumes: `isOverdue` / `isDueSoon` / `TaskStatus` / `Project`(`./index` 已有)
- Produces(后续任务全部依赖,名字逐字使用):
  ```ts
  export interface ProjectStats {
    /** 任务进度等权平均(0~1);空项目为 0。 */
    progress: number;
    /** 全部任务数(含已完成)。 */
    taskCount: number;
    doneCount: number;
    /** 未完成且逾期的任务数。 */
    overdueCount: number;
    /** 未完成且临期(今天或明天截止)的任务数。 */
    dueSoonCount: number;
  }
  export type ProjectHealthKind = "overdue" | "dueSoon" | "notStarted" | "normal";
  export function getProjectHealthKind(stats: ProjectStats): ProjectHealthKind;
  /** 各项目进度的等权平均(0~1);空数组返回 0。spec §7 口径。 */
  export function averageProjectProgress(projectProgresses: number[]): number;
  ```

- [ ] **Step 1: 写失败测试** `project-health.test.ts`,断言:`getProjectHealthKind` 优先级 overdue > dueSoon > notStarted > normal(构造 4 组 `ProjectStats`,其中一组 `progress: 0, overdueCount: 1` 必须得 `"overdue"`);`averageProjectProgress([]) === 0`、`averageProjectProgress([0.48, 0.62, 0.35]) ≈ 0.4833`、空项目 `[0.5, 0]` → `0.25`。
- [ ] **Step 2: 跑测试确认失败** — `pnpm vitest run packages/types/src/project-health.test.ts`,期望 FAIL(模块不存在)。
- [ ] **Step 3: 实现** `project-health.ts`:判定按 `overdueCount > 0 → "overdue"`,`dueSoonCount > 0 → "dueSoon"`,`progress === 0 → "notStarted"`,否则 `"normal"`;平均用 `reduce`,`length === 0` 返回 0。index.ts 加 re-export。
- [ ] **Step 4: 跑测试确认通过** — 同 Step 2 命令,期望 PASS;再跑 `pnpm vitest run packages/types`,存量绿。
- [ ] **Step 5: Commit** — `feat(types): add project health kind and equal-weight project average`

### Task 2: 路由——`SpaceModule` 扩展 `"projects"`

**Files:**
- Modify: `apps/web/src/lib/routes.ts:6`
- Test: `apps/web/src/lib/routes.test.ts`

**Interfaces:**
- Produces: `type SpaceModule = "dashboard" | "projects" | "kanban" | "calendar" | "analysis" | "settings"`(`moduleHref` 不变,自动支持)。

- [ ] **Step 1: 写失败测试** — `routes.test.ts` 的 `moduleHref` describe 追加 `expect(moduleHref("personal", "projects")).toBe("/space/personal/projects")` 与 `moduleHref("growth", "projects")` 断言。
- [ ] **Step 2: 跑测试确认失败** — `pnpm vitest run apps/web/src/lib/routes.test.ts`,期望 TS 报错/FAIL(`"projects"` 不在联合类型)。
- [ ] **Step 3: 实现** — `routes.ts:6` 联合类型插入 `"projects"`。
- [ ] **Step 4: 跑测试确认通过** — 同 Step 2。
- [ ] **Step 5: Commit** — `feat(web): add projects to SpaceModule route type`

### Task 3: 侧栏导航「项目」入口 + nav/meta 文案

**Files:**
- Modify: `apps/web/src/components/layout/SpaceNavMenu.tsx`(labelKey 联合、`PERSONAL_MODULES`、图标)
- Modify: `apps/web/src/i18n/messages/zh.json`、`en.json`(`nav` + `meta` 两个命名空间)

**Interfaces:**
- Consumes: Task 2 的 `SpaceModule`。
- Produces: 导航在 Dashboard 与 Kanban 之间渲染「项目」项;`nav.projects`(zh `项目` / en `Projects`);`meta.projectsTitle`(zh `项目 · Open Doing` / en `Projects · Open Doing`)。

- [ ] **Step 1: 改 i18n** — `nav` 加 `"projects"`,`meta` 加 `"projectsTitle"`,zh/en 同 key。
- [ ] **Step 2: 改 SpaceNavMenu** — `SpaceNavModule["labelKey"]` 联合加 `"projects"`;新增 `FolderIcon`(`viewBox="0 0 24 24"`,`<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>`,属性照抄现有 `DashboardIcon`);`PERSONAL_MODULES` 在 dashboard 项之后插入 `{ module: "projects", labelKey: "projects", Icon: FolderIcon }`(`TEAM_MODULES` 经展开自动获得)。
- [ ] **Step 3: 验证** — `pnpm vitest run apps/web/src/i18n/messages-parity.test.ts apps/web/src/i18n/cjk-guard.test.ts` PASS;`pnpm --filter @open-doing/web exec next typegen && pnpm --filter @open-doing/web exec tsc --noEmit` 无新错误。
- [ ] **Step 4: Commit** — `feat(web): add projects entry to space sidebar nav`

### Task 4: 团队项目列表聚合查询

**Files:**
- Modify: `apps/web/src/features/projects/service.ts`
- Test: `apps/web/src/features/projects/service.test.ts`(DB 测试,沿用该文件现有 seed 辅助)

**Interfaces:**
- Consumes: Task 1 的 `ProjectStats`;`getTaskProgress` / `isOverdue` / `isDueSoon`(`@open-doing/types`);schema `tasks` / `projects` / `subtasks`。
- Produces:
  ```ts
  export interface ProjectListItem {
    project: Project;
    stats: ProjectStats;
  }
  /** 团队项目列表(创建时间升序),附每项目聚合。today 由调用方注入(YYYY-MM-DD)。 */
  export async function getTeamProjectListWithStats(
    teamId: string,
    today: string,
    client: DbClient = db,
  ): Promise<ProjectListItem[]>;
  ```

- [ ] **Step 1: 写失败测试** — seed:团队 3 个项目(A 2 任务 1 done 1 子任务全完、B 有 1 个逾期 todo + 1 个明天截止 in_progress、C 空项目),断言:顺序 = 创建升序;A `stats` 为 `{progress:0.75, taskCount:2, doneCount:1, overdueCount:0, dueSoonCount:0}` 形状(按 seed 精确算);B `overdueCount:1, dueSoonCount:1`,health 由 `getProjectHealthKind` 得 `"overdue"`;C `progress:0, taskCount:0`;空团队返回 `[]`。
- [ ] **Step 2: 跑测试确认失败** — `set -a; source apps/web/.env.local; set +a && pnpm vitest run apps/web/src/features/projects/service.test.ts`,期望 FAIL(函数不存在)。
- [ ] **Step 3: 实现** — 两次并行查询照 `team-overview/service.ts` 的 `listTeamTaskSnapshots` 模式(子任务计数用派生表 left join 一次 group by,防 N+1;任务只需 `id/status/dueDate/projectId` + `spaceType='team'` + `projects.teamId = teamId` 过滤):项目行 `orderBy asc(createdAt)`,JS 侧按 `projectId` 分组累加(每个任务 `getTaskProgress({status, subtasks})` push 进数组;done 计 `status === "done"`;`dueDate && isOverdue(...)` / `isDueSoon(...)` 且 `status !== "done"` 计入两个 count);`progress` 用 Task 1 的 `averageProjectProgress`(每项目等权,即任务进度平均——`getTaskProgress` 平均就是等权,复用即可)。空项目构造 `ProjectStats` 零值。**不改** `listTeamProjects` 及任何既有函数。
- [ ] **Step 4: 跑测试确认通过** — 同 Step 2,含存量用例全绿。
- [ ] **Step 5: Commit** — `feat(projects): add team project list aggregation with health stats`

### Task 5: 个人项目列表聚合查询

**Files:**
- Modify: `apps/web/src/features/personal/projects/service.ts`
- Test: `apps/web/src/features/personal/projects/service.test.ts`

**Interfaces:**
- Consumes / Produces: 同 Task 4,仅签名与过滤不同:
  ```ts
  /** 个人项目列表(创建时间升序);只按 owner_id + spaceType='personal' 过滤。 */
  export async function getPersonalProjectListWithStats(
    userId: string,
    today: string,
    client: DbClient = db,
  ): Promise<ProjectListItem[]>;
  ```
  `ProjectListItem` 从 `@/features/projects/service` import(现有跨 feature import 先例:kanban service ← projects service)。

- [ ] **Step 1: 写失败测试** — seed 两用户各建项目:本人 A(1 逾期)+ B(空),他人 C;断言只返回 A、B(创建升序)、C 不可见;A `overdueCount:1`。
- [ ] **Step 2: 跑测试确认失败** — 同 Task 4 方式,路径换 `features/personal/projects/service.test.ts`。
- [ ] **Step 3: 实现** — 与 Task 4 同构,过滤条件 `spaceType: "personal"` + `ownerId = userId`(任务查询经 join projects 按 `projects.ownerId` 过滤)。**不改** `listPersonalProjects`(其"最近活动降序"是其他 4 个调用方的既有行为)。
- [ ] **Step 4: 跑测试确认通过** — 同 Step 2,存量绿。
- [ ] **Step 5: Commit** — `feat(personal): add personal project list aggregation with health stats`

### Task 6: `ProjectStatsCard` 展示组件

**Files:**
- Create: `apps/web/src/features/projects/components/ProjectStatsCard.tsx`
- Test: `apps/web/src/features/projects/components/ProjectStatsCard.test.tsx`

**Interfaces:**
- Consumes: Task 1 `ProjectStats` / `ProjectHealthKind`;vendored `Badge`、`Progress`(`color` prop);`useTranslations("projects")`。
- Produces:
  ```ts
  export const PROJECT_CARD_TEST_ID = "projects-list-card";
  export interface ProjectStatsCardProps {
    name: string;
    description?: string;
    href: string;
    stats: ProjectStats;
    health: ProjectHealthKind;
  }
  export function ProjectStatsCard(props: ProjectStatsCardProps): ReactElement;
  ```
  渲染:整卡 `<Link href data-testid>`;名称 + 健康徽标(Badge:overdue → `className="bg-[var(--status-overdue-bg)] text-[var(--error)]"`,dueSoon → `variant="warning"`,notStarted → `variant="neutral"`,normal → `variant="success"`;文案 key `healthOverdue/healthDueSoon/healthNotStarted/healthNormal`);描述两行截断(`line-clamp-2`);`Progress value={stats.progress} color={...}`(颜色映射 overdue `var(--error)` / dueSoon `var(--warning)` / 其余 `var(--primary)`);底行:`{Math.round(progress*100)}%` + `cardTasks {taskCount}` + `cardDone {doneCount}` + (`overdueCount > 0` 时)`cardOverdue`。
- i18n(Task 7 一起提交亦可,但 key 清单在此锁定):`projects` 命名空间加 `listTitle/listSubtitleTeam/listSubtitlePersonal/summaryTeam/summaryPersonal/sortNote/cardTasks/cardDone/cardOverdue/healthOverdue/healthDueSoon/healthNotStarted/healthNormal/listEmptyTitle/listEmptyHint`(zh/en,占位符 `{count}/{percent}`)。

- [ ] **Step 1: 写失败测试** — i18n Provider setup 照 `ConfirmModal.test.tsx`;断言:health 各态渲染对应徽标文案;`overdueCount: 0` 时不渲染逾期文案;href 落在 Link 上;描述缺省时不渲染描述节点。
- [ ] **Step 2: 跑测试确认失败** — `pnpm vitest run apps/web/src/features/projects/components/ProjectStatsCard.test.tsx`,FAIL。
- [ ] **Step 3: 实现组件 + i18n keys**(zh/en 同步;样式对齐原型 16/17:卡片 `rounded-xl border bg-card`,`hover:border-primary`)。
- [ ] **Step 4: 跑测试确认通过** — 同 Step 2;`messages-parity` / `cjk-guard` 一并跑绿。
- [ ] **Step 5: Commit** — `feat(projects): add project stats card component`

### Task 7: 两个列表页(RSC)

**Files:**
- Create: `apps/web/src/app/(dashboard)/space/[teamSlug]/projects/page.tsx`
- Create: `apps/web/src/app/(dashboard)/space/personal/projects/page.tsx`
- Modify: `apps/web/e2e/utils/testids.ts`(`TEST_IDS.projects` 加 `projectsListPage: "projects-list-page"`、`projectsNewTeamButton: "projects-new-team-button"`、`projectsListCard: "projects-list-card"`——值必须与 Task 6 `PROJECT_CARD_TEST_ID` 一致)

**Interfaces:**
- Consumes: Task 4/5 service、Task 6 卡片、Task 3 `nav.projects`、`PageHeader`、`EmptyState`、`date.todayCaption` + `WEEKDAY_KEYS`、`teamProjectNewHref` / `teamProjectHref` / `personalProjectHref` / `moduleHref`、`getTeamBySlug` + `getMembership` + `can(role, "team:manage_projects")`、`NewPersonalProjectButton`。
- Produces: `/space/{ref}/projects` 可渲染;页面容器 `data-testid="projects-list-page"`;团队新建按钮 `data-testid="projects-new-team-button"`。

- [ ] **Step 1: 团队页** — 结构照 `space/[teamSlug]/kanban/page.tsx`:`generateMetadata` 用 `meta.teamModuleTitle` + `tNav("projects")`(非成员不泄露团队名);页面体:requireUser → getTeamBySlug + getMembership,任一空 `notFound()`;`today = todayInShanghai()`;`getTeamProjectListWithStats(team.id, today)`;`PageHeader`(title `t("listTitle")`,subtitle `listSubtitleTeam`,actions:`can(membership.role, "team:manage_projects")` 时渲染 `Button asChild variant="outline" size="sm"` → `Link href={teamProjectNewHref(teamSlug)}`,文案复用既有 key `projects.submitCreate`?——**否**,新增 `projects.newProjectButton`(zh `新建项目` / en `New Project`));摘要行(`summaryTeam` percent 传 `Math.round(averageProjectProgress(list.map(i => i.stats.progress))*100)` + 右侧 `date.todayCaption`,同 kanban 用法);`sortNote`;网格 `grid gap-4 [grid-template-columns:repeat(auto-fill,minmax(280px,1fr))]`,卡片 `href={teamProjectHref(teamSlug, p.project.slug)}`、`health={getProjectHealthKind(p.stats)}`;列表为空渲染 `EmptyState`(title `listEmptyTitle`,description `listEmptyHint`)。
- [ ] **Step 2: 个人页** — 结构照 `space/personal/dashboard/page.tsx` 头部:requireUser → `getPersonalProjectListWithStats(user.id, today)`;actions 放 `<NewPersonalProjectButton />`;卡片 `href={personalProjectHref(...)}`;subtitle 用 `listSubtitlePersonal`;摘要 `summaryPersonal`;metadata 用 `meta.projectsTitle`。
- [ ] **Step 3: 验证** — `pnpm --filter @open-doing/web exec next typegen && pnpm --filter @open-doing/web exec tsc --noEmit` 通过;`pnpm vitest run apps/web/src/i18n` 绿;起 `pnpm dev` 后人工冒烟:两空间 `/projects` 可达、侧栏高亮正确、member 账号看不到新建按钮(有 seed 团队可用 `pnpm db:seed` 数据,登录 林夏)。
- [ ] **Step 4: Commit** — `feat(projects): add space-level project list pages`

### Task 8: e2e 流 13

**Files:**
- Create: `apps/web/e2e/flows/13-projects-module.spec.ts`

**Interfaces:**
- Consumes: e2e utils `registerUser` / `createPersonalProject` / `uniqueUsername` / `uniqueLabel`(`../utils/flows`)、`TEST_IDS`、flow 02 的建团队 + 邀请成员模式(照抄其两上下文结构)。

- [ ] **Step 1: 写用例**(3 个 test):
  1. 个人:注册 → 建 2 个个人项目 → 侧栏点「项目」→ 断言 URL `/space/personal/projects`、两张卡可见、点卡进详情页;空态另起一个新用户直接访问 `/space/personal/projects` 见 `EmptyState`。
  2. 团队 owner:注册建团队建项目 → `/space/{slug}/projects` 见卡片与 `projectsNewTeamButton`。
  3. 团队 member 与非成员:第二账号在**受邀前**访问 `/space/{ownerSlug}/projects` 断言 404(不泄露存在性);受邀加入后同页**无** `projectsNewTeamButton`、卡片可见;action 层 member 403 由 `features/projects/actions.test.ts` 既有用例覆盖,若该文件无 member 直调用例则补一个(照其现有权限用例模式)。
- [ ] **Step 2: 跑通** — 停 dev server(Next 16 同目录 dev 锁)后 `pnpm --filter @open-doing/web test:e2e -- flows/13-projects-module.spec.ts` PASS。
- [ ] **Step 3: Commit** — `test(e2e): add projects module flow`

### Task 9: 全量回归

- [ ] **Step 1:** `pnpm lint && pnpm test`(先 `set -a; source apps/web/.env.local; set +a`)。
- [ ] **Step 2:** `pnpm --filter @open-doing/web exec next typegen && pnpm typecheck`。
- [ ] **Step 3:** `git status` 确认改动仅限本计划文件清单;按需分主题补 commit,准备 PR 说明(引用 spec 与原型 16/17)。
