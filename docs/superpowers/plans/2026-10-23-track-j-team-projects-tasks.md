# M2 轨道 J（团队项目与任务）实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**执行方式：** 待定 —— 计划评审后由用户选择 Native / Subagent-driven。

**目标：** 完成 `docs/V1_TASKS.md` §7 轨道 J（J-1…J-5）：团队项目 CRUD、团队任务服务（创建/编辑/指派/删除/子任务/评论）、项目页列表与看板双视图、团队任务详情页，使 M2 出口检查中的「建项→派活→评论→拖看板」链路可用（通知由 N 轨道后续接线核验）。

**架构：** 沿用 M1 已定型的分层——服务层承载全部鉴权与业务规则（`actorId` 入参 + `assertCan`/任务级权限纯函数，可脱离请求上下文直测）；Server Actions 是薄封装（`requireUser()` → service → `ActionResult<T>`）；多写操作 `db.transaction` 包裹，通知在同事务内经 savepoint 写入（桩实现无去重，见裁决 6）。页面保持 RSC 取数，antd 交互件下沉 `"use client"`。

**技术栈：** Next.js 16 App Router + React 19 + TS strict + antd v6 + Tailwind 4（无 preflight）+ PostgreSQL/Drizzle + Vitest；拖拽复用已预装的 `@dnd-kit/core|sortable|utilities`。零新增依赖。

**规格：** `docs/V1_TASKS.md` §7 轨道 J（权威）；`docs/2026-10-21-open-doing-v1-design.md` §5/§6/§7/§8/§9.4/§9.5/§10；原型 `docs/prototypes/{project-list,project-board,task-detail}.html`（文案与布局）。

## Context（开工前已核实）

- 仓库基线：main `75a2f88`（M1 已合并），当前 worktree `/Users/wangtao/orca/workspaces/open-doing/teamwork`。`m1-frozen` tag 尚未打（Task 0 补打）。
- 可直接复用：`components/ui/task-detail/{TaskDetailView.tsx,types.ts}`（P-4 定稿，J-5 复用 + 加法扩展）、`components/ui/{StatusTag,ProgressBar,DueText,EmptyState,ConfirmModal,UserAvatar}.tsx`、`features/teams/permissions.ts`（`can/assertCan/getMembership/TeamRole/TeamPermissionError`）、`features/teams/service.ts`（`getTeamBySlug/listMembers`）、`features/notifications/service.ts`（`createNotification` 桩）、`lib/slug.ts`（`generateUniqueSlug`）、`lib/domain-error.ts`、`lib/today.ts`、`server/db/testing.ts`、`src/server/db/errors.ts`（`isUniqueViolation`）。
- 参照实现（只读，不修改）：`features/personal/tasks/{service,actions}.ts` 与 `components/{ProjectTaskTable,PersonalKanban,NewTaskModal,TaskRowActions,TaskDetailClient}.tsx`——J 的团队版本按同样结构写，但**不 import personal 目录下的组件/服务**（P 轨道所有权）。
- J 轨道**不做**：团队概览页（D-1/D-2）、通知中心/cron（N）、治理（G：移除成员/退出/转让/解散/删项目危险区 UI）、我的任务聚合页（D）。
- 空白占位：`features/projects/`、`features/tasks/` 只有 `.gitkeep`；`teams/[teamSlug]/projects/[projectSlug]/{,tasks/[taskId]/}.gitkeep` 可随实文件删除。

## Global Constraints

- 技术栈固定；写操作只走 Server Actions，返回 `ActionResult<T>`（`src/features/auth/actions.ts`）；每个 action 独立鉴权；服务层同样断言权限，不靠隐藏按钮。
- 页面 RSC 取数；antd 交互件下沉 `"use client"`，序列化数据经 props 传入；日期一律 `YYYY-MM-DD`（Asia/Shanghai，`todayInShanghai()` 注入）。
- 进度口径 `getTaskProgress`；已完成任务不参与逾期/临期；逾期 = today > dueDate 且非 done。
- 删除一律硬删除 + DB `ON DELETE CASCADE` 兜底（项目→任务→子任务/评论/通知），UI 二次确认。
- **不得修改**：`src/app/(dashboard)/layout.tsx`、`src/components/layout/**`、`src/server/db/schema.ts` 与迁移、`packages/types/**`、`features/personal/**`、`features/auth,s/users/**`、`features/notifications/**`。
- 唯一所有权例外：`src/features/teams/components/TeamsNav.tsx`（+ `TeamsNavItem.tsx` 加法扩参）由 J 修改，见裁决 1。
- 中文文案、中文注释密度与现有代码一致；commit message 一律英语（`Co-Authored-By: Claude Code <noreply@anthropic.com>` 落款）。
- 每任务收尾：`pnpm vitest run <相关文件>` 绿；Task 6 统一跑 `pnpm test && pnpm -r typecheck && pnpm -r lint && pnpm --filter @open-doing/web build`。
- DB 测试依赖 `TEST_DATABASE_URL`（本地 `open_doing_test`）；未设置时用例 `skipIf` 并打印提示。

## 规格裁决（已定，执行时不再讨论）

1. **侧栏团队项目**：`TeamsNav` 属 T 轨道，但 J-1 验收要求「项目出现在团队侧栏段」。单人开发、T 已合并无并发 → J-1 直接扩 `TeamsNav`，`TeamsNavItem` 加可选 `depth?: "child"` 做二级缩进；在任务板记录所有权例外。
2. **新建任务弹窗范围**：团队项目页**只列本团队项目**（不列个人空间项）。原型 `project-list.html` 的「个人空间」选项不还原：J 不依赖 P 的 action，避免跨空间误建。
3. **基线**：Task 0 在当前 HEAD 补打 `m1-frozen`，从它拉 `track/team-projects`，在现有 worktree 内开发（单人不再另建 worktree）。
4. **TaskDetailView 扩展**：责任人选择器（原型有、共享件未实现）以**可选 props 加法扩展**：`assigneeOptions?: { id: string; name: string }[]`、`onAssign?: (assigneeId: string) => Promise<void>`；仅 `space === "team" && permissions.canAssign && assigneeOptions && onAssign` 时渲染。个人页不传，行为不变。
5. **未指派**：v1 只由成员离开产生（G-1）。UI 不提供「清空责任人」；`updateTeamTask` 的 `assigneeId` 若传入必须是团队内成员，不接受 null。
6. **通知去重**：`createNotification` 桩只做 INSERT，`(user_id, task_id, type)` 唯一索引会让「同一任务第二条评论通知」「再次指派」触发 23505 并炸掉整个事务。J 在自己的服务里用 `notifySafely`（嵌套事务 = savepoint，吞掉唯一冲突）调用；N-1 接管后由服务内部去重，届时 `notifySafely` 可简化。
7. **member 改派**：member 只能改派**自己负责**的任务（改派后即失去编辑权）；owner/admin 可改派任意任务。建任务时所有成员都可指派给团队内任何人（设计 §5）。
8. **团队任务必属项目**：`space_type='team'` 的任务 `project_id` 必填；任务详情/列表查询都以 `projects.team_id` 判定可见性，跨空间 URL 一律表现为不存在。
9. **任务级权限错误**：新增 `TaskPermissionError`（`features/tasks/permissions.ts`），与团队级 `TeamPermissionError` 同为 action 层可映射表单错误的唯一两类权限异常。

## Review Focus（规格隐含、最易咬人的五类输入，均已分配到任务测试）

1. **同一任务的第二次同类通知**（第二条评论、A→B→A 再指派）→ 唯一索引 23505 不得连累业务写入。（Task 2 `notifySafely` 测试）
2. **跨空间 URL**：个人任务 `/my/tasks/[id]` 经团队路径访问、团队任务经 `/my` 访问 → 一律 404 / 服务返回 null，不泄露存在性。（Task 2 + Task 5）
3. **member 越权**：编辑/删除他人任务、改派他人任务、创建/编辑/删除项目 → 服务层与 action 层双双拒绝（不是只隐藏按钮）。（Task 1/2）
4. **非成员访问团队项目页/任务/项目操作** → `notFound()` 或空列表，不返回 403 明细。（Task 1/3）
5. **未指派任务**（`assigneeId=null`，成员离开后的真实数据）→ 列表「未指派」、详情「未指派」、member 无编辑权、owner/admin 可改派，页面不崩。（Task 2/3/4/5）

---

## 任务分解（实施顺序：Task 0 → 1 → 2 → 3 → 4 → 5 → 6）

> 路径相对 `apps/web/src/`。每步 = 写失败测试 → 跑红 → 实现 → 跑绿 → commit。DB 测试模板照抄 `features/teams/service.test.ts`（`describe.skipIf(!hasTestDatabase)`、`setupTestDb`/`closeTestDb`、`beforeEach` 重建、`createUser` 直插 helpers）。

### Task 0: 基线与任务板

**Files:**
- Modify: `docs/V1_TASKS.md`（轨道表 J 行 → 🟡 + asher；J-1…J-5 标 `[~]`；§4 所有权矩阵 TeamsNav 行加例外说明）
- Create: `docs/superpowers/plans/2026-10-23-track-j-team-projects-tasks.md`（本文件）

- [ ] **Step 1: 补打基线 tag 并建分支**

```bash
git tag m1-frozen 75a2f88            # 若已存在则跳过
git switch -c track/team-projects m1-frozen
git worktree list
```

Expected: 当前 worktree 分支为 `track/team-projects`，HEAD = m1-frozen 指向的提交。

- [ ] **Step 2: 确认基线绿（可只跑快测）**

Run: `pnpm test`
Expected: 全绿；无 `TEST_DATABASE_URL` 时 DB 用例 skip 而其余通过。

- [ ] **Step 3: 更新任务板并提交**

```bash
git add docs/V1_TASKS.md docs/superpowers/plans/2026-10-23-track-j-team-projects-tasks.md
git commit -m "docs: start M2 team projects and tasks track with plan"
```

---

### Task 1: J-1 团队项目 CRUD + 侧栏接线

**Files:**
- Create: `features/projects/service.ts`、`features/projects/service.test.ts`
- Create: `features/projects/actions.ts`、`features/projects/actions.test.ts`
- Create: `features/projects/components/TeamProjectForm.tsx`（client，新建/编辑共用弹窗表单体）
- Create: `features/projects/components/TeamProjectHeaderActions.tsx`（client，编辑/删除）
- Create: `app/(dashboard)/teams/[teamSlug]/projects/new/page.tsx`
- Modify: `features/teams/components/TeamsNav.tsx`、`features/teams/components/TeamsNavItem.tsx`（加 `depth?: "child"`）
- Delete: `app/(dashboard)/teams/[teamSlug]/projects/[projectSlug]/.gitkeep`（若 J-3 尚未建 page）

**Interfaces（Produces，J-3/G-4 消费）:**

```ts
// features/projects/service.ts
export const PROJECT_NAME_MAX_LENGTH = 50;
export const PROJECT_DESCRIPTION_MAX_LENGTH = 500;
export async function listTeamProjects(teamId: string, client?: DbClient): Promise<Project[]>          // createdAt 升序
export async function listTeamProjectsForTeams(teamIds: string[], client?: DbClient): Promise<Project[]>
export async function getTeamProjectBySlug(teamId: string, slug: string, client?: DbClient): Promise<Project | null>
export async function createTeamProject(input: { teamId: string; actorId: string; name: string; description?: string }, client?: DbClient): Promise<Project>
export async function updateTeamProject(input: { teamId: string; projectId: string; actorId: string; name?: string; description?: string }, client?: DbClient): Promise<Project>  // slug 不变
export async function deleteTeamProject(input: { teamId: string; projectId: string; actorId: string }, client?: DbClient): Promise<void>
// features/projects/actions.ts（"use server"）
export async function createTeamProjectAction(input: { teamId: string; name: string; description?: string }): Promise<ActionResult<Project>>
export async function updateTeamProjectAction(input: { teamId: string; projectId: string; name?: string; description?: string }): Promise<ActionResult<Project>>
export async function deleteTeamProjectAction(input: { teamId: string; projectId: string }): Promise<ActionResult<true>>
```

- 写操作一律 `getMembership(teamId, actorId)` → `assertCan(role, "team:manage_projects")`（member/非成员抛 `TeamPermissionError`）。
- 名称 1–50 trim 必填、描述 ≤500（空串存 null）；校验失败抛 `DomainError(msg, "name" | "description")`。
- slug：`generateUniqueSlug(name, (candidate) => 该 (teamId, candidate) 是否已存在)`——重名生成 `x-2`，不同团队互不影响。
- 删除级联由 DB 外键兜底（`projects → tasks → subtasks/comments/notifications`）。

- [ ] **Step 1: 写失败的 service 测试**（`features/projects/service.test.ts`）
  - owner 建项目成功、`slug` 由名称生成、`teamId` 正确、`ownerId` 为 null。
  - admin 可建；member 与非成员 → `TeamPermissionError`（`team:manage_projects`）。
  - 同名两次 → `name` / `name-2`；两个团队各自 `name` 不冲突（按团队作用域查重）。
  - 空名 → `DomainError` field `name`；描述 501 字 → field `description`。
  - `updateTeamProject` owner 改名后 `slug` 不变、描述清空存 null；member → 拒绝。
  - `deleteTeamProject` owner 删除后项目下任务/子任务/评论/通知全部消失（先直插任务+子任务+评论）；member → 拒绝。
  - `getTeamProjectBySlug(另一团队 id, slug)` → null；`listTeamProjectsForTeams` 只返回传入团队的项目。

- [ ] **Step 2: 跑红**

Run: `pnpm vitest run apps/web/src/features/projects/service.test.ts`
Expected: FAIL —— 模块不存在 / `createTeamProject is not a function`。

- [ ] **Step 3: 实现 `features/projects/service.ts`**（签名见 Interfaces；校验与 slug 规则见上）
  - 内部 `requireManageRole(teamId, actorId, client)`：`getMembership` → `assertCan(role, "team:manage_projects")`，返回 role。
  - 内容校验失败抛 `DomainError`；权限错误由 `assertCan` 抛 `TeamPermissionError`。

- [ ] **Step 4: 跑绿**

Run: `pnpm vitest run apps/web/src/features/projects/service.test.ts`
Expected: PASS。

- [ ] **Step 5: 写失败的 actions 测试并实现**

`features/projects/actions.test.ts`（`vi.mock("@/features/auth/session")` + `vi.mock("./service")`）：
- 未登录 → `{ ok:false, errors:{ form:"请先登录" } }` 且不触达 service；
- `TeamPermissionError` → `errors.form === "没有权限执行该操作"`；`DomainError` → 对应字段；未知异常 → `errors.form === "操作失败，请稍后重试"`。

先跑红，再实现 `features/projects/actions.ts`（`"use server"`；`requireUser()` 在 `try` 外，映射沿用 `features/personal/tasks/actions.ts` 的 `toFailure` 模式并补 `TeamPermissionError` 分支），再跑绿。

- [ ] **Step 6: 页面与组件（无单测，靠 typecheck/lint + Task 6 冒烟）**
  - `projects/new/page.tsx`（RSC）：`requireUser` → `getTeamBySlug` 不存在 `notFound()` → `getMembership` 为空或 `can(role,"team:manage_projects")===false` → `notFound()`（不泄露）；渲染 `TeamProjectForm`，成功 `router.push(`/teams/${teamSlug}/projects/${project.slug}`)`（J-3 前该路由 404，可接受）+ `router.refresh()`。
  - `TeamProjectForm`：名称必填、描述可选，字段错误 + form 错误按 `NewTaskModal` 模式展示。
  - `TeamProjectHeaderActions`：仅 owner/admin 渲染「编辑」「删除」；删除走 `ConfirmModal`（文案：删除后项目下任务、子任务与评论一并删除，且不可恢复）。
  - `TeamsNav`：为每个团队渲染二级 `TeamsNavItem depth="child"` 的项目链接 `/teams/${team.slug}/projects/${project.slug}`。数据：`listTeamsForUser` → `Promise.all` 取各团队 `getMembership` 角色 → `listTeamProjectsForTeams(teams.map(t => t.id))` 按 `teamId` 分组。owner/admin 在项目段末尾渲染「＋ 新建项目」→ `/teams/${team.slug}/projects/new`。文案与原型侧栏一致。
  - `TeamsNavItem` 加可选 `depth?: "child"`：`child` 时 `pl-8`、字号 12.5px，默认不变。

- [ ] **Step 7: 静态检查**

Run: `pnpm --filter @open-doing/web typecheck && pnpm --filter @open-doing/web lint`
Expected: 无错误。

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/features/projects apps/web/src/features/teams/components/TeamsNav.tsx \
  apps/web/src/features/teams/components/TeamsNavItem.tsx apps/web/src/app/\(dashboard\)/teams
git commit -m "feat(projects): team project CRUD with scoped slugs and sidebar wiring"
```

---

### Task 2: J-2 团队任务服务（创建/编辑/指派/删除 + 子任务 + 评论）

**Files:**
- Create: `lib/task-fields.ts`（共享字段校验，J 专用；personal 目录不动）
- Create: `features/tasks/permissions.ts`、`features/tasks/permissions.test.ts`
- Create: `features/tasks/service.ts`、`features/tasks/service.test.ts`
- Create: `features/tasks/actions.ts`、`features/tasks/actions.test.ts`

**Interfaces（Produces，J-3/4/5 消费）:**

```ts
// lib/task-fields.ts（纯函数，无 DB）
export const TASK_TITLE_MAX_LENGTH = 200;
export const SUBTASK_TITLE_MAX_LENGTH = 200;
export const COMMENT_MAX_LENGTH = 2000;
export function isUuid(value: string): boolean
export function validateTaskTitle(value: unknown, label?: "任务" | "子任务"): string   // DomainError field "title"
export function normalizeTaskDescription(value: unknown): string | null
export function validateTaskDueDate(value: unknown): string | null                     // DomainError field "dueDate"
export function validateTaskStatus(value: unknown): TaskStatus                         // DomainError field "status"
export function validateCommentContent(value: unknown): string                         // DomainError field "content"

// features/tasks/permissions.ts（纯函数，禁止 import DB）
export class TaskPermissionError extends Error { readonly action: "task:edit" | "task:delete" | "task:assign" }
export function canCreateTask(role: TeamRole | null): boolean                   // role !== null
export function canEditTask(input: { role: TeamRole | null; actorId: string; assigneeId: string | null }): boolean
export function canDeleteTask(input: { role: TeamRole | null; actorId: string; assigneeId: string | null }): boolean
export function canAssignTask(input: { role: TeamRole | null; actorId: string; assigneeId: string | null }): boolean
export function canComment(role: TeamRole | null): boolean                      // role !== null
export function assertCanEditTask(input: ...): void                             // 抛 TaskPermissionError("task:edit")
export function assertCanDeleteTask(input: ...): void
export function assertCanAssignTask(input: ...): void

// features/tasks/service.ts
export interface TeamTaskRow extends Task { subtasks: Subtask[]; assigneeName: string | null }
export async function listTeamProjectTasks(input: { teamId: string; projectId: string; actorId: string }, client?: DbClient): Promise<TeamTaskRow[]>  // createdAt 升序
export async function getTeamTaskDetail(input: { teamId: string; taskId: string; actorId: string }, client?: DbClient): Promise<TaskDetailModel | null>
export async function createTeamTask(input: { teamId: string; projectId: string; actorId: string; title: string; description?: string; dueDate?: string | null; assigneeId?: string | null }, client?: DbClient): Promise<Task>
export async function updateTeamTask(input: { teamId: string; taskId: string; actorId: string; title?: string; description?: string; dueDate?: string | null; status?: TaskStatus; assigneeId?: string }, client?: DbClient): Promise<Task>
export async function deleteTeamTask(input: { teamId: string; taskId: string; actorId: string }, client?: DbClient): Promise<void>
export async function addTeamSubtask(input: { teamId: string; taskId: string; actorId: string; title: string }, client?: DbClient): Promise<Subtask>
export async function removeTeamSubtask(input: { teamId: string; taskId: string; actorId: string; subtaskId: string }, client?: DbClient): Promise<void>
export async function toggleTeamSubtask(input: { teamId: string; taskId: string; actorId: string; subtaskId: string; completed: boolean }, client?: DbClient): Promise<Subtask>
export async function addTeamComment(input: { teamId: string; taskId: string; actorId: string; content: string }, client?: DbClient): Promise<Comment>
export async function deleteTeamComment(input: { teamId: string; taskId: string; actorId: string; commentId: string }, client?: DbClient): Promise<void>

// features/tasks/actions.ts（"use server"，全部 requireUser() 在 try 外）
export async function createTeamTaskAction(input: { teamId: string; projectId: string; title: string; description?: string; dueDate?: string | null; assigneeId?: string | null }): Promise<ActionResult<Task>>
export async function updateTeamTaskAction(taskId: string, input: { teamId: string; title?: string; description?: string; dueDate?: string | null; status?: TaskStatus; assigneeId?: string }): Promise<ActionResult<Task>>
export async function deleteTeamTaskAction(input: { teamId: string; taskId: string }): Promise<ActionResult<true>>
export async function addTeamSubtaskAction(input: { teamId: string; taskId: string; title: string }): Promise<ActionResult<Subtask>>
export async function removeTeamSubtaskAction(input: { teamId: string; taskId: string; subtaskId: string }): Promise<ActionResult<true>>
export async function toggleTeamSubtaskAction(input: { teamId: string; taskId: string; subtaskId: string; completed: boolean }): Promise<ActionResult<Subtask>>
export async function addTeamCommentAction(input: { teamId: string; taskId: string; content: string }): Promise<ActionResult<Comment>>
export async function deleteTeamCommentAction(input: { teamId: string; taskId: string; commentId: string }): Promise<ActionResult<true>>
```

**服务层内部规则（唯一实现处）:**
- `requireMember(teamId, actorId, client)`：`getMembership` 为空 → `DomainError("团队不存在或无权访问")`；返回 `TeamRole`。
- `requireTeamTask(input)`：join `tasks → projects`，条件 `tasks.id`、`tasks.spaceType='team'`、`projects.teamId=teamId`；未命中（含个人任务、跨团队任务、非法 UUID）→ `DomainError("任务不存在或无权访问")`。列表/详情对不可见一律返回 `null`/`[]`。
- `notifySafely(client, input)`：`await client.transaction((tx) => createNotification(input, tx)).catch(e => { if (!isUniqueViolation(e)) throw e; })`——注释写明「N-1 接管去重后此包装可移除」。
- `createTeamTask`：校验字段 → `requireMember`（任何角色可建）→ 项目必须属于该团队；`assigneeId` 缺省 = actor；显式传入时必须是该团队成员，否则 `DomainError("只能指派给团队内成员", "assigneeId")`。事务内插任务；`assigneeId !== actorId` 时 `notifySafely({ userId: assigneeId, type: "task_assigned", teamId, projectId, taskId, actorId })`。
- `updateTeamTask`：先 `requireTeamTask`；内容字段（title/description/dueDate/status）任一存在 → `assertCanEditTask`；`assigneeId` 存在且与当前不同 → `assertCanAssignTask` + 新责任人必须是团队成员。事务内更新 `updatedAt`；通知：
  - 责任人变化 → 新责任人（≠ actor）`task_assigned`；
  - 内容是 owner/admin 改动且**原**责任人为他人 → `task_changed_by_admin`（收件人 = 原责任人）。
- `deleteTeamTask`：`assertCanDeleteTask` 后删除（级联 DB）。
- 子任务三件套：`requireTeamTask` + `assertCanEditTask`；勾选只改 `completed/completedAt`，**不改主任务状态/updatedAt**。
- 评论：任何成员可发（`canComment`）；`assigneeId && assigneeId !== actorId` → 通知责任人 `task_commented`；删除仅作者本人（owner/admin 也不行）。
- `getTeamTaskDetail`：组装 `TaskDetailModel`（`assigneeName`、`projectName`、`creatorName`=created_by 用户名、`progress` 用 `getTaskProgress`、评论含作者名）。

- [ ] **Step 1: 写 `lib/task-fields.ts` 与 `features/tasks/permissions.ts` 的失败测试**
  - `permissions.test.ts`（纯函数表驱动）：`canCreateTask`/`canComment` → owner/admin/member true、null false；`canEditTask`/`canDeleteTask` → owner/admin 任意任务 true、member 仅 `assigneeId === actorId`、`assigneeId=null` 时 member false；`canAssignTask` 同上（未指派任务 member false）；`assertCanEditTask` 抛 `TaskPermissionError` 且 `action === "task:edit"`。
  - `permissions.ts` 只允许 `import type { TeamRole } from "@/features/teams/permissions"`（该模块含 DB import，必须类型擦除）。

- [ ] **Step 2: 跑红**

Run: `pnpm vitest run apps/web/src/features/tasks/permissions.test.ts`
Expected: FAIL —— 模块不存在。

- [ ] **Step 3: 实现两个纯函数模块并跑绿**

`lib/task-fields.ts` 按 Interfaces 导出常量与校验（`DomainError` 字段名与个人轨道一致）；`features/tasks/permissions.ts` 规则：`canEditTask`/`canDeleteTask`/`canAssignTask` = `role === "owner" || role === "admin" || (role === "member" && assigneeId !== null && assigneeId === actorId)`。

Run: `pnpm vitest run apps/web/src/features/tasks/permissions.test.ts`
Expected: PASS。

- [ ] **Step 4: 写失败的 service 测试**（`features/tasks/service.test.ts`，DB 用例）
  - 建任务：member 可建、默认指派自己、`spaceType='team'`；指派他人 → 落库且一条 `task_assigned`（teamId/projectId/taskId/actorId 正确）；指派非成员 → field `assigneeId`；指派自己 → **不**产生通知。
  - 编辑：member 改自己的任务成功；member 改他人任务 → `TaskPermissionError`；owner 改他人任务 → 成功且被改人收到 `task_changed_by_admin`；owner 改自己任务不产生该通知。
  - 改派：owner 改派 → 新责任人收到 `task_assigned`；member 改派自己的任务成功；member 改派他人任务 → 拒绝。
  - **幂等撞车**：同一任务连续两条评论（不同成员）→ 两条评论都落库，`notifications` 中 `task_commented` 只有 1 条（Review Focus #1）。
  - 评论：评论他人任务通知责任人；评论自己的任务不通知；非成员 → 拒绝；删除他人评论 → 拒绝，删除自己的成功。
  - 子任务：member 在他人任务上加子任务 → 拒绝；在自己任务上加/勾/删成功；勾选不改主任务状态。
  - 可见性：非成员 `listTeamProjectTasks` → `[]`、`getTeamTaskDetail` → null；**个人任务用团队 taskId 查询 → null**（Review Focus #2）；跨团队删除 → `DomainError`。
  - 未指派：直插 `assignee_id=null` 任务 → 列表 `assigneeName=null`；member 编辑 → 拒绝；owner 改派成功（Review Focus #5）。

- [ ] **Step 5: 跑红**

Run: `pnpm vitest run apps/web/src/features/tasks/service.test.ts`
Expected: FAIL。

- [ ] **Step 6: 实现 `features/tasks/service.ts`**（内部规则见上；`notifySafely` 用嵌套事务吞 23505）
  - 先实现 `requireMember`、`requireTeamTask`、`notifySafely`，再按创建 → 编辑 → 删除 → 子任务 → 评论 → 列表/详情的顺序补齐。

- [ ] **Step 7: 跑绿**

Run: `pnpm vitest run apps/web/src/features/tasks/service.test.ts`
Expected: PASS（含唯一索引撞车用例）。

- [ ] **Step 8: 写失败的 actions 测试并实现**
  - `features/tasks/actions.test.ts`：未登录 → `"请先登录"`；`TaskPermissionError`/`TeamPermissionError` → `errors.form === "没有权限执行该操作"`；`DomainError` 字段映射；未知异常 → 通用文案。
  - 实现 `features/tasks/actions.ts`，跑绿。

- [ ] **Step 9: 静态检查 + Commit**

Run: `pnpm --filter @open-doing/web typecheck && pnpm --filter @open-doing/web lint`

```bash
git add apps/web/src/lib/task-fields.ts apps/web/src/features/tasks
git commit -m "feat(tasks): team task service with assignment rules and notifications"
```

---

### Task 3: J-3 团队项目页列表视图

**Files:**
- Create: `app/(dashboard)/teams/[teamSlug]/projects/[projectSlug]/page.tsx`（RSC，列表/看板共用的壳）
- Create: `features/tasks/components/TeamProjectHeader.tsx`（client：视图切换 + 新建任务 + 项目编辑/删除入口）
- Create: `features/tasks/components/TeamProjectTaskTable.tsx`（client）
- Create: `features/tasks/components/NewTeamTaskModal.tsx`（client）
- Create: `features/tasks/components/TeamTaskRowActions.tsx`（client）

**Interfaces（Props 契约，J-4 复用）:**

```ts
// TeamProjectTaskTable
export interface TeamProjectTaskTableProps {
  tasks: TeamTaskRow[];
  members: { id: string; name: string }[];       // 责任人筛选
  today: string;                                  // Asia/Shanghai YYYY-MM-DD
  projectId: string;
  projects: { id: string; name: string }[];       // 弹窗可选（本团队）
  role: TeamRole;                                 // 行内权限（canEditTask 纯函数）
  actorId: string;
}
// NewTeamTaskModal: { open, projects, defaultProjectId, members, defaultAssigneeId, onSuccess, onCancel }
```

- [ ] **Step 1: 实现页面壳（RSC）**

**页面装配（RSC）:**
1. `requireUser()` → `getTeamBySlug(teamSlug)` 或 `getMembership` 为空 → `notFound()`。
2. `getTeamProjectBySlug(team.id, projectSlug)` 为空 → `notFound()`；`listTeamProjects(team.id)`、`listMembers(team.id)`、`listTeamProjectTasks({ teamId, projectId, actorId })` 并行取。
3. `view` 取 `searchParams.view`，`"board"` 之外一律列表（J-4 接看板）。
4. 面包屑「团队名 / 项目名」；页头标题 + 副标 `${tasks.length} 个任务 · ${参与成员数} 位成员参与`（参与成员 = 任务责任人去重数）。
5. `TeamProjectHeader`：`Segmented 列表/看板`（写 `?view=`）+ `＋ 新建任务`（所有成员）+ owner/admin 才显示「编辑」「删除」。

- [ ] **Step 2: 列表表格与组件**

**列表表格（对照 `project-list.html`）:**
- 5 列：任务 / 状态 / 责任人（`UserAvatar` + 用户名，空 → 「未指派」）/ 进度 / 截止日期；已完成行置灰 + 标题删除线。
- 筛选：状态（全部/三态）、责任人（全部/各成员/未指派）、排序（按截止日期默认，无日期排后；按状态；按创建时间）；右上「共 N 条」。
- 分页：`pageSize = 9`（9+ 行密度），antd `Pagination`；筛选变化回到第 1 页。
- 进度列口径与个人项目一致：有子任务 `x/y 子任务 · N%`，无子任务「无子任务，按状态计 N%」。
- 空项目 → `EmptyState`（「暂无任务」+ 新建按钮）；筛选无结果 → 「没有符合筛选条件的任务」。
- 窄屏：表格卡片内横向滚动（`overflow-x-auto min-w-[860px]`），页面不横向溢出。

- [ ] **Step 3: 行内操作与新建任务弹窗**

**行内操作（TeamTaskRowActions）:** 「⋯」菜单——标记状态（`canEditTask` 为 false 时禁用整组状态项并隐藏删除）、编辑（跳详情页）、删除（`ConfirmModal`）。新建任务弹窗：标题必填、项目下拉**仅本团队项目**（默认当前项目）、责任人下拉 = 团队成员（默认自己）、截止日期、描述；成功 `message.success("任务已创建")` + `router.refresh()`。

- [ ] **Step 4: 静态检查与回归**

Run: `pnpm vitest run apps/web/src/features/tasks && pnpm --filter @open-doing/web typecheck && pnpm --filter @open-doing/web lint`
Expected: 全绿（UI 无单测，行为由 Task 6 冒烟覆盖）。

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/features/tasks/components apps/web/src/app/\(dashboard\)/teams
git commit -m "feat(tasks): team project list view with filters, pagination and task creation"
```

---

### Task 4: J-4 团队项目页看板拖拽

**Files:**
- Create: `features/tasks/components/TeamKanban.tsx`（client）
- Modify: `app/(dashboard)/teams/[teamSlug]/projects/[projectSlug]/page.tsx`（`view === "board"` 渲染看板）

- [ ] **Step 1: 实现 `TeamKanban`**

**拖拽库选型（记录，任务板勾选时抄一行）：** 沿用 `@dnd-kit/core`——F-2 已预装（M0 后禁止新增依赖）；提供 Pointer/Keyboard 传感器，键盘可达；无 HTML5 DnD 的拖影与 touch 冲突；个人看板已验证同一套用法。

**实现要点（对照 `project-board.html`，复用 `PersonalKanban` 的结构与 dnd-kit 用法）:**
- 三列 未开始/进行中/已完成，列头计数；`DndContext` + `PointerSensor(activationConstraint.distance 6)` + `KeyboardSensor` + `closestCorners`。
- 拖卡落列 → 乐观更新 → `updateTeamTaskAction(taskId, { teamId, status })`；失败回滚 + `message.error(firstError)`；成功 `router.refresh()`。
- **仅 `canEditTask` 为 true 的卡片可拖**（`useDraggable({ disabled })`）；他人卡片显示责任人头像，不可拖。
- 窄屏（<861px，与 `min-[861px]` 断点一致）关闭拖拽，卡片内给状态按钮（同 `TaskStatusButtons` 模式，J 自己实现 `TeamTaskStatusButtons`）。
- 卡片显示：标题、进度条（有子任务）、责任人（`UserAvatar` + 名）、截止日期（`DueText`）；已完成置灰。
- 顶部保留与列表一致的「责任人 / 状态」筛选（看板按筛选后的集合分列）。

- [ ] **Step 2: 页面接入 `?view=board`**

修改 `page.tsx`：`view === "board"` 时用 `TeamKanban`（props 与表格同源），列表分支保持不变。

- [ ] **Step 3: 静态检查 + 手工验证**

Run: `pnpm --filter @open-doing/web typecheck && pnpm --filter @open-doing/web lint`
Expected: 绿。浏览器：拖卡改状态持久化、他人卡片不可拖、375px 单列 + 状态按钮可用。

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/features/tasks/components/TeamKanban.tsx "apps/web/src/app/(dashboard)/teams"
git commit -m "feat(tasks): team project kanban with drag-to-change status"
```

---

### Task 5: J-5 团队任务详情页

**Files:**
- Create: `app/(dashboard)/teams/[teamSlug]/projects/[projectSlug]/tasks/[taskId]/page.tsx`（RSC）
- Create: `features/tasks/components/TeamTaskDetailClient.tsx`（client 包装件）
- Modify: `components/ui/task-detail/types.ts`（加法扩展）
- Modify: `components/ui/task-detail/TaskDetailView.tsx`（责任人选择器）

**Interfaces（共享件加法扩展，个人页零影响）:**

```ts
// types.ts 追加到 TaskDetailViewProps
assigneeOptions?: { id: string; name: string }[];
onAssign?: (assigneeId: string) => Promise<void>;
```

- [ ] **Step 1: 扩展共享件（加法）**

在 `types.ts` 追加两个可选字段；在 `TaskDetailView.tsx` 的「责任人」`MetaRow` 内：当 `space === "team" && permissions.canAssign && assigneeOptions && onAssign` 时渲染 antd `Select`（当前 `task.assigneeId`，选项为成员列表，`showSearch` 按名过滤，含「未指派」占位但不可选空值——见裁决 5）；`onChange` 调 `onAssign`，失败回滚选中值。其余分支保持现有只读展示；个人页不传 props，行为零变化。

- [ ] **Step 2: 页面与包装件**

- 页面：`requireUser` → `getTeamTaskDetail({ teamId, taskId, actorId })` → null `notFound()`；`backHref = /teams/${teamSlug}/projects/${projectSlug}`；`currentUserId = user.id`；`creatorName` 由服务填充；`listMembers(team.id)` → `assigneeOptions`（`{ id, name: username }`）。

- [ ] **Step 3: 权限位与动作映射**

- 权限位（服务端计算）：`role = membership.role`；`permissions = { canEdit: canEditTask(...), canDelete: canDeleteTask(...), canAssign: canAssignTask(...) }`。
- `TeamTaskDetailClient` 把 `TaskDetailView` 的 `onAction` 映射到 Task 2 的 actions（含 `addSubtask/removeSubtask`），并额外映射 `onAssign` → `updateTeamTaskAction(task.id, { teamId, assigneeId })`；失败 `message.error` 并 rethrow（沿用 `TaskDetailClient` 的 `runAction` 模式）。

- [ ] **Step 4: 静态检查 + 手工验证**

Run: `pnpm --filter @open-doing/web typecheck && pnpm --filter @open-doing/web lint`
Expected: 绿。浏览器：member 打开他人任务只见只读控件；owner 可改派；个人任务详情页无变化。

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/ui/task-detail apps/web/src/features/tasks/components/TeamTaskDetailClient.tsx "apps/web/src/app/(dashboard)/teams"
git commit -m "feat(tasks): team task detail page with role-gated controls and assignee picker"
```

---

### Task 6: 收尾核验

- [ ] `pnpm test`（含 DB 用例，`TEST_DATABASE_URL` 指向 `open_doing_test`）全绿。
- [ ] `pnpm -r typecheck && pnpm -r lint && pnpm --filter @open-doing/web build` 全绿。
- [ ] `docs/V1_TASKS.md`：勾选 J-1…J-5 各验收项（未能完成的写明原因），轨道 J 状态 ✅。
- [ ] 浏览器冒烟（`pnpm dev -p 3003`）：owner 建项目 → 建任务派给 member → member 在项目页看到并拖卡 → 详情页评论 → owner 编辑 member 的任务（触发 `task_changed_by_admin`）→ 查 `notifications` 表。
- [ ] 任务板记录 INT-2 集成议题：N-1 接线清单需覆盖 J-2 的 `task_assigned / task_changed_by_admin / task_commented`；`notifySafely` 的去重包装在 N-1 后可移除；TeamsNav 的所有权例外。
- [ ] 分支合入 main，打 tag `m2-frozen` 由 INT-2 执行（J 轨道内不自打）。

## Verification（端到端）

1. 单测：`pnpm test` —— 项目 CRUD 权限/级联、任务权限矩阵、通知落库与幂等撞车、跨空间可见性全绿。
2. 静态：typecheck / lint / build。
3. 手工：owner/admin/member/非成员四种身份走项目页与任务详情；375px 无横向溢出；看板拖拽失败回滚可见。
