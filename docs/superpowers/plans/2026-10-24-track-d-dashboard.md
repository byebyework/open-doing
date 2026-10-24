# 轨道 D：聚合仪表盘实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 落地 `docs/V1_TASKS.md` §8 轨道 D：我的任务跨空间聚合页（D-1）、团队概览健康度与风险区（D-2）、成员负载与未指派区（D-3）。

**Architecture:** 新建 `src/features/dashboard/**`（所有权归 D，不碰 personal/teams/tasks 目录），读模型全部 SQL 聚合；`my/page.tsx` 整体替换 F-5 占位；`teams/[teamSlug]/page.tsx` 新建（所有权矩阵归 D）。列表复用既有详情页路由做跳转，页面保持 RSC 取数，交互件（弹窗、下钻）下沉 client 组件。

**Tech Stack:** Next.js 16 App Router + React 19 + antd v6 + Drizzle/PostgreSQL + Vitest（DB 用例走 `TEST_DATABASE_URL`）。

**Spec:** `docs/V1_TASKS.md` §8 轨道 D（D-1/D-2/D-3）+ INT-1 议题②（概览路由接线）；文案对照 `docs/prototypes/my-tasks.html` 与 `docs/prototypes/team-overview.html`。

## Global Constraints

- 进度口径：任务进度用 `getTaskProgress`（子任务完成数/总数；无子任务按状态 0/0.5/1）；项目/团队进度为**任务等权简单平均**（空 = 0），复用 `@open-doing/types` 的 `aggregateProjectProgress`；个人项目不参与团队聚合。
- 日期口径统一 Asia/Shanghai；截止日当天不算逾期次日起算、临期 = 今天/明天、已完成不计；today 由调用方注入（复用 `@open-doing/types` 的 `isOverdue`/`isDueSoon`；`Asia/Shanghai` today 计算参照 `features/notifications/due-scan.ts` 的 `shanghaiToday`）。
- 聚合在 **SQL 侧**完成（计数/平均），不全表拉内存；空段有空状态。
- D-2/D-3 只读：任何成员可访问概览页，页面无任何写操作按钮（无催办/改派）。
- 权限：`my` 页只见本人任务；团队概览非成员 404（不泄露存在性，参照设置页 `getTeamBySlug`+`getMembership` 模式）。
- 颜色只用设计令牌；中文文案/注释；commit 英语；不新增依赖；RSC 取数、交互件 `"use client"`。
- 测试真库无 mock（`setupTestDb` 模式）；收尾 `pnpm -r typecheck/lint/test` + build 全绿。
- 健康度阈值常量化（可调，记录在常量文件 JSDoc）。

## Review Focus

1. **新用户空数据**：无任何任务/项目时统计全 0、无 NaN 进度（`aggregateProjectProgress` 空数组 = 0）、两段均空态 → Task 1/2 测试。
2. **未指派团队任务**（成员离开置空 assignee）：不计入任何成员负载、不出现在"我负责的"、只出现在未指派区 → Task 3 测试。
3. **已完成任务**：不计进行中/临期/逾期（`status='done'` 过滤）→ Task 1 测试。
4. **时区口径**：today/weekStart 注入 Asia/Shanghai（UTC 下午跑时"今天"已是次日）→ Task 1 对 weekStart/today 用固定时刻断言。
5. **跨空间权限**：my 页聚合严格 `assignee = session user`；概览页非成员 404 → Task 2/3 测试。

---

### Task 1: D-1 聚合查询服务（`features/dashboard/my-tasks/service.ts`）

**Files:**
- Create: `apps/web/src/features/dashboard/my-tasks/service.ts`
- Create: `apps/web/src/features/dashboard/my-tasks/service.test.ts`

**Interfaces:**
- Consumes: `tasks`/`projects`/`teams`/`subtasks`（schema）、`isDueSoon`/`isOverdue`/`addDays`（`@open-doing/types`）、`DbClient`/`db`。
- Produces（Task 2 消费）:
  ```ts
  export interface MyTaskStats { inProgress: number; dueSoon: number; overdue: number; doneThisWeek: number }
  export async function getMyTaskStats(input: { userId: string; today: string; weekStart: string }, client?: DbClient): Promise<MyTaskStats>
  // SQL count：assignee=userId 全空间；前三项 status != 'done' 且分别
  //   inProgress=status='in_progress' / dueSoon=due_date IN (today, addDays(today,1)) /
  //   overdue=due_date < today；doneThisWeek=status='done' AND updated_at >= weekStart。
  export interface MyTaskListItem {
    id: string; title: string; status: TaskStatus; dueDate: string | null;
    projectId: string | null; projectName: string | null; projectSlug: string | null;
    teamName: string | null; teamSlug: string | null; spaceType: 'personal' | 'team';
    subtaskCount: number; completedSubtaskCount: number;
    href: string;   // personal: /my/tasks/{id}；team: /teams/{teamSlug}/projects/{projectSlug}/tasks/{id}
  }
  export async function listMyPersonalTasks(userId: string, client?: DbClient): Promise<MyTaskListItem[]>
  // 本人个人任务：projectId IS NULL 或 projectId ∈ 本人个人项目；projectName=null 时展示"不属于项目"口径由 UI 判断。
  export async function listMyTeamTasks(userId: string, client?: DbClient): Promise<MyTaskListItem[]>
  // 跨全部团队 assignee=userId。
  // 两个列表均 ORDER BY due_date ASC NULLS LAST, created_at DESC；子任务计数用左联聚合（不在循环里查）。
  export interface CrossSpaceProjectOption { projectId: string; projectName: string; projectSlug: string | null; teamId: string | null; teamName: string | null }
  export async function listCrossSpaceProjects(userId: string, client?: DbClient): Promise<CrossSpaceProjectOption[]>
  // 个人项目（owner=userId）+ 本人所在团队的项目（grouped 由 UI 处理）；个人在前。
  export function getWeekStart(today: string): string   // Asia/Shanghai 周一日期（纯函数，addDays 实现）
  ```

- [ ] **Step 1: 写失败测试**（`setupTestDb` 模式；today 注入 `'2026-10-24'`，weekStart `'2026-10-19'`）
  - 统计：进行中 1、临期（今天+明天各 1=2）、逾期 1、本周已完成 1；已完成任务不计前三项；他人任务不计；未指派团队任务不计（Review Focus 1/2/3）。
  - `getWeekStart('2026-10-24')` = `'2026-10-19'`（周六回周一）；`getWeekStart('2026-10-19')` = 自身。
  - 两个列表：排序（有日期在前升序、无日期最后）；href 两种空间拼法正确；子任务计数正确（3/5）；个人无项目任务 projectName=null。
  - `listCrossSpaceProjects`：个人项目在前、团队项目带 teamName；他人项目不出现。
- [ ] **Step 2: 跑测试确认失败** — `pnpm exec vitest run --project web apps/web/src/features/dashboard/my-tasks/service.test.ts`
- [ ] **Step 3: 实现 `service.ts`**（统计一条 SQL 多 count 或四条单 count 皆可，说明选择；列表两条 join 查询 + 子任务聚合）
- [ ] **Step 4: 跑测试通过**；`pnpm --filter @open-doing/web typecheck`
- [ ] **Step 5: Commit** — `feat(dashboard): cross-space my-task aggregation queries`

### Task 2: D-1 我的任务页整体替换 + 跨空间新建任务弹窗

**Files:**
- Modify: `apps/web/src/app/(dashboard)/my/page.tsx`（整体替换 F-5 占位；文件所有权归 D）
- Create: `apps/web/src/features/dashboard/my-tasks/components/NewTaskModal.tsx`（client）
- Create: `apps/web/src/features/dashboard/my-tasks/components/MyTaskTable.tsx`（client 或纯服务端表格，含移动端卡内横滚）

**Interfaces:**
- Consumes: Task 1 全部函数；`createPersonalTask`（`features/personal/tasks/service.ts`，个人项目/无项目）、`createTeamTask`（`features/tasks/service.ts`，团队项目；默认指派创建者）；共享件 `DueText`/`StatusTag`/`ProgressBar`/`EmptyState`；`shanghaiToday` 口径（复制或从 due-scan 提取均可，二选一并在注释注明）。
- Produces: `/my` 真实页——统计卡（进行中 / 今日明日到期 / 已逾期 / 本周已完成，文案对照原型）、「个人任务」段（项目 chip，无项目显示"不属于项目"）、「我负责的团队任务」段（跨团队，带团队名）、默认截止日期升序（无日期排后）、空段空状态、新建任务弹窗项目选择跨空间全列（个人项目 + 不属于项目 + 各团队项目分组）。
- [ ] **Step 1: 实现服务端页面**（RSC：`requireUser` → today/weekStart → stats + 两列表 → 渲染；已完成行置灰删除线样式参照 J-3 的列表实现）
- [ ] **Step 2: 实现 `NewTaskModal`**（antd Modal + Form；提交分流：团队项目 → `createTeamTask` 的 action、个人 → `createPersonalTask` 的 action；成功 `message.success` + `router.refresh()`；字段：标题必填、可选项目、可选截止日期、描述）
- [ ] **Step 3: 实现 `MyTaskTable`**（列：标题链接/项目 chip/状态/截止日期/进度；375px 卡内横滚）
- [ ] **Step 4: 验证** — typecheck/lint 绿；全量 `pnpm exec vitest run`；`pnpm dev -p 3005` 手工冒烟：注册→建个人项目+任务→统计卡数字正确→弹窗建团队任务出现在"我负责的"段（冒烟数据清理）
- [ ] **Step 5: Commit** — `feat(dashboard): my-tasks page with cross-space aggregation and new-task modal`

### Task 3: D-2/D-3 团队概览服务与页面（健康度/风险区/成员负载/未指派）

**Files:**
- Create: `apps/web/src/features/dashboard/team-overview/service.ts`
- Create: `apps/web/src/features/dashboard/team-overview/service.test.ts`
- Create: `apps/web/src/features/dashboard/team-overview/constants.ts`（健康度阈值）
- Create: `apps/web/src/features/dashboard/team-overview/components/MemberLoadList.tsx`（client，下钻）
- Create: `apps/web/src/app/(dashboard)/teams/[teamSlug]/page.tsx`
- Modify: `apps/web/src/features/teams/components/TeamsNav.tsx:61`（团队项首个链接 `/teams/${slug}/settings` → `/teams/${slug}` 概览——INT-1 议题②落地的最小接线）

**Interfaces:**
- Consumes: `getTeamBySlug`/`listMembers`（teams/service）、`getMembership`/`can`（permissions）、`aggregateProjectProgress`/`isOverdue`/`isDueSoon`（types）、共享件。
- Produces:
  ```ts
  export interface ProjectHealth {
    projectId: string; projectName: string; projectSlug: string;
    progress: number;                       // aggregateProjectProgress(各任务进度, 任务数)，空项目 0
    hasOverdue: boolean; hasDueSoon: boolean; taskCount: number;
  }
  export interface RiskTaskItem { id: string; title: string; dueDate: string; kind: 'overdue' | 'dueSoon'; assigneeName: string | null; projectName: string; href: string }
  export interface MemberLoad { userId: string; username: string; inProgress: number; dueSoon: number; overdue: number; tasks: Array<{ id: string; title: string; status: TaskStatus; dueDate: string | null; projectName: string; href: string }> }
  export interface UnassignedTaskItem { id: string; title: string; dueDate: string | null; projectName: string; href: string }
  export async function getTeamOverview(input: { teamId: string; teamSlug: string; today: string }, client?: DbClient): Promise<{
    projects: ProjectHealth[]; riskTasks: RiskTaskItem[]; members: MemberLoad[]; unassigned: UnassignedTaskItem[];
    teamStats: { projectCount: number; avgProgress: number; dueSoonCount: number; overdueCount: number };
  }>
  // 风险区排序：逾期在前、临期在后，各按 dueDate 升序。
  // 成员负载只统计未指派为 null 的任务；未指派任务单独成区（Review Focus 2）。
  // constants.ts: HEALTH_COLOR_RULES —— hasOverdue → error 色；否则 hasDueSoon → warning 色；否则正常（JSDoc 记录阈值为可调常量）。
  ```
  页面分区对照 `team-overview.html`：统计头（在册项目/团队整体进度/临期/已逾期）、项目健康度条、风险区（点击进详情）、成员负载（行内下钻看该成员各项目任务）、未指派区（提示 admin 重新指派，链接到任务详情，不在概览页直接改）。只读：无任何写按钮。

- [ ] **Step 1: 写失败测试**（seed：owner+admin+member、2 项目、各状态任务、1 未指派任务）
  - 健康度：空项目 0%；有逾期项目的着色规则 true/false；进度为任务等权平均（2 任务 0.2/0.6 → 0.4）。
  - 风险区：逾期在前临期在后；已完成任务不出现；未指派逾期任务也进风险区（assigneeName=null）。
  - 成员负载：inProgress/dueSoon 计数正确；未指派任务不计入任何成员、出现在 unassigned（Review Focus 2）；非本人任务不串。
  - 非成员团队不查（权限在页面层 404，服务层假设已校验——JSDoc 注明）。
- [ ] **Step 2: 跑测试确认失败**
- [ ] **Step 3: 实现 service + constants + 页面 + MemberLoadList**（聚合 SQL 完成；风险区/负载可一次取团队任务集在 JS 分组——团队规模有界，注释说明该取舍）
- [ ] **Step 4: TeamsNav 接线**（`:61` 首项 href 改概览路由；其余不变）
- [ ] **Step 5: 验证** — 全量测试/typecheck/lint 绿；`pnpm dev -p 3005` 冒烟：概览页分区渲染、侧栏团队项进概览、非成员直访 404、375px 无横向溢出
- [ ] **Step 6: Commit** — `feat(dashboard): team overview with health, risk zone and member load`

### Task 4: 收尾——任务板回写 + 全量检查

**Files:**
- Modify: `docs/V1_TASKS.md`（D-1/D-2/D-3 验收勾选、轨道表 D 行 🟡→✅ 负责人 asher、INT-1 议题②标注已由 D-3 接线落地）

- [ ] **Step 1:** `pnpm -r typecheck && pnpm -r lint && pnpm -r test` + `pnpm --filter @open-doing/web build`（显式 `DATABASE_URL`）全绿
- [ ] **Step 2:** 任务板逐条勾选（对照 V1_TASKS D-1/D-2/D-3 原文；INT-1 议题②补"已解决（D-3 TeamsNav 接线）"）
- [ ] **Step 3: Commit** — `docs(tasks): mark track D complete`
