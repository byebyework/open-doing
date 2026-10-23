# M1 个人空间（P 轨道）实施计划（P-1 ~ P-5）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 `track/personal` 上完成 v1 任务板 M1 的个人空间轨道：个人项目 CRUD、个人任务/子任务/评论服务、项目页（列表+看板）、任务详情页（含 J-5 复用的共享件）、侧栏个人段接线——单人可完整管理个人项目与任务。

**Architecture:** 全部代码落在 `apps/web/src/features/personal/**`（P 轨道独占目录）+ 两个路由文件 + 共享件 `components/ui/task-detail/`；写操作走 Server Actions 返回 `ActionResult<T>`（复用 auth 的定义）；页面 RSC 取数、antd 交互件下沉 `"use client"`；复用 M0 冻结的纯函数与 ui 组件。

**Tech Stack:** 同 M0（Next.js 16.4.2 App Router、React 19、antd v6、Tailwind 4 无 preflight、Drizzle/PostgreSQL、Vitest、@dnd-kit）

**Spec:** `docs/V1_TASKS.md` §2（全局约束）、§6 轨道 P（P-1~P-5 逐条验收）、§4 文件所有权矩阵（P 只拥有 `features/personal/**`，共享件 `components/ui/task-detail/` 归 P 创建）+ `docs/2026-10-21-open-doing-v1-design.md`（产品行为）+ `docs/prototypes/personal-project.html`、`personal-project-board.html`、`my-tasks.html`、`task-detail.html`（视觉与文案来源——四个原型的逐字文案与结构规格已转录进下方各任务，实现以本计划为准，不必再回读原型）

## 环境基线（已完成，非本计划任务）

- worktree `/Users/wangtao/orca/workspaces/open-doing/od-personal`，分支 `track/personal`，基线 `m0-frozen`（= 312a397）。
- 共享容器 `initial-postgres-1`（宿主 5433，**不要在 track worktree 里 `docker compose up`**）；独立库 `open_doing_personal` / `open_doing_personal_test` 已建并已迁移；`apps/web/.env.local` 已配置。
- 本地验证端口 **3001**（`pnpm dev -p 3001`）。
- 干净 worktree 上 `pnpm typecheck` 需先 `pnpm build`（Next 16 生成路由类型）。

## Global Constraints

- **文件所有权**：只新建/修改 `src/features/personal/**`、路由 `src/app/(dashboard)/my/{projects/[projectSlug],tasks/[taskId]}/page.tsx`、共享件 `src/components/ui/task-detail/**`、少量通用 lib（本计划指名者）。**不改** dashboard layout、`components/layout/**`、`my/page.tsx`（D 轨道所有）、theme/providers/globals.css、schema/迁移。
- 不新增任何依赖（M0 已装齐，含 `@dnd-kit/core`/`sortable`/`utilities`）。
- 日期：截止日期仅日期 `YYYY-MM-DD`；逾期=今天>due 且非 done；临期=due∈{今天,明天}；已完成不计；统一 Asia/Shanghai（`today` 由 `lib/today.ts` 注入）。任务状态只由手动操作改变（按钮/拖拽），**勾选子任务不改主任务状态**。
- 个人任务复用 tasks 表（`space_type='personal'`）；`assignee_id` 恒为本人（应用层断言）；不依赖也不修改 J 轨道的 `features/tasks|projects`。
- 服务层零权限容忍：每个函数断言归属（`space_type='personal' AND assignee_id=userId`；项目 `owner_id=userId`），失败抛领域错误 → action 映射 `ActionResult`。
- 进度：有子任务=完成数/总数；无子任务=0/0.5/1（`getTaskProgress`）；项目进度=任务进度简单平均，空=0（`aggregateProjectProgress`）。
- 删除=硬删除（UI 二次确认，DB 级联兜底）；重名 slug 追加 `-2/-3` 不冲突。
- 中文文案与注释（对照原型）；commit message 英语；每任务以 `pnpm test`（DB 套件用 `TEST_DATABASE_URL`）+ `pnpm build` + `pnpm -r typecheck && pnpm lint` 全绿收尾。
- antd 交互件必须 `"use client"`；页面保持 RSC；颜色只取令牌；375px 无横向溢出。

## Review Focus

1. **归属断言遗漏**：个人空间数据只有本人可见——每个 service 函数都必须带归属过滤；直接访问他人 taskId/projectSlug 返回 404（`notFound()`），不得泄露存在性。→ 每个任务的 service 测试必须含"他人数据返回 null/抛错"用例。
2. **勾选子任务与主任务状态耦合**：勾选只切 `completed/completedAt`，进度实时联动，但主任务状态不变。→ P-2 测试断言 toggle 后主任务 `status` 不变。
3. **乐观更新的回滚**：看板拖卡失败必须回滚并 message 提示。→ P-3 代码实现 + Playwright/手工验证路径。
4. **TaskDetailView props 契约冻结**：J-5 只消费不复检，props 与 V1_TASKS P-4 契约逐字一致。→ P-4 评审核对契约。
5. **中文 slug 的生成**：纯中文项目名转 slug 后可能为空。→ P-1 测试覆盖纯 ASCII、混合、纯中文三种输入。

---

### Task 1: P-1 个人项目 CRUD

**Files:**
- Create: `apps/web/src/lib/domain-error.ts`、`apps/web/src/lib/slug.ts`、`apps/web/src/lib/today.ts`、`apps/web/src/features/personal/projects/service.ts`、`apps/web/src/features/personal/projects/actions.ts`、`apps/web/src/features/personal/projects/components/PersonalProjectFormModal.tsx`
- Create: `apps/web/src/app/(dashboard)/my/projects/[projectSlug]/page.tsx`（最小占位页：项目名/描述/编辑/删除，P-3 替换为完整列表+看板）
- Test: `apps/web/src/lib/slug.test.ts`、`apps/web/src/features/personal/projects/service.test.ts`

**Interfaces:**
- Consumes: `db`/`DbClient`（`server/db/client.ts`）、`Project`（`@open-doing/types`）、`ActionResult<T>`（`features/auth/actions.ts`）、`requireUser()`（`features/auth/session.ts`）、`setupTestDb()`（`server/db/testing.ts`）
- Produces（后续任务与 D 轨道消费）:
  - `class DomainError extends Error { readonly field?: string }`（`lib/domain-error.ts`，全仓通用领域错误；action 层捕获并映射 `{ [field ?? "form"]: message }`）
  - `generateUniqueSlug(base: string, isTaken: (slug: string) => Promise<boolean>): Promise<string>`（`lib/slug.ts`：ASCII 化 base（小写 `[a-z0-9-]`，连续 `-` 归一，去首尾 `-`；结果为空则用 `project`）；冲突追加 `-2`、`-3`…）
  - `todayInShanghai(): string`（`lib/today.ts`：`Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai" })` → `YYYY-MM-DD`）
  - `listPersonalProjects(userId: string, client?: DbClient): Promise<Project[]>`（按 `createdAt` 升序）
  - `getPersonalProjectBySlug(userId: string, slug: string, client?: DbClient): Promise<Project | null>`（非本人/不存在 → null）
  - `createPersonalProject(userId: string, input: { name: string; description?: string }, client?: DbClient): Promise<Project>`（名称必填 1–50 字；slug 用 `generateUniqueSlug`，查重范围 `owner_id=userId`；description ≤500 字）
  - `updatePersonalProject(userId: string, projectId: string, input: { name?: string; description?: string }, client?: DbClient): Promise<Project>`（断言 `owner_id=userId`；改名仅更新 name/description，**slug 不变**）
  - `deletePersonalProject(userId: string, projectId: string, client?: DbClient): Promise<void>`（断言归属；级联任务/子任务/评论由 DB 外键兜底）
  - Server Actions：`createPersonalProjectAction(input) => ActionResult<Project>`、`updatePersonalProjectAction(projectId, input) => ActionResult<Project>`、`deletePersonalProjectAction(projectId) => ActionResult<true>`（`"use server"`，内部 `requireUser()`，`DomainError.field` → 字段错误，未知错误 → `form: "操作失败，请稍后重试"`）
  - `PersonalProjectFormModal`（`"use client"`，props `{ open: boolean; mode: "create" | "edit"; project?: { id: string; name: string; description?: string }; onSuccess: () => void; onCancel: () => void }`：antd Modal+Form，create 模式调 createAction，edit 模式调 updateAction，成功后 `onSuccess` 并 message 提示。文案逐字对照 `my-tasks.html`「新建个人项目」弹窗——弹窗标题「新建个人项目」（edit 模式「编辑项目」）；顶部 info 提示「个人项目仅你自己可见，与团队项目相互独立；项目中的任务同样会汇总到「我的任务」。」；字段 label「项目名称」（placeholder「例如：学习成长、装修、求职准备」）、「描述（可选）」（placeholder「这个项目用来归集什么事？」）；底部「取消」/「创建项目」（edit 模式「保存」））

- [ ] **Step 1: 写失败测试**：`slug.test.ts`（纯 ASCII `"My Project!"` → `my-project`；混合 `"学习 growth"` → 含 `growth`；纯中文 → base 回落 `project`；`isTaken` 恒 true 时返回 `project-2`）；`service.test.ts`（`describe.skipIf(!process.env.TEST_DATABASE_URL)`，`setupTestDb()` 前置）：创建返回 slug 唯一的 Project；重名第二个项目 slug 为 `xxx-2`；他人 `getPersonalProjectBySlug` → null；更新/删除他人项目抛 `DomainError`；删除后项目及其任务级联消失；中文项目名创建成功
- [ ] **Step 2: 确认失败**：`pnpm test` → 新增用例 FAIL
- [ ] **Step 3: 实现**（lib → service → actions → modal → 占位路由页；路由页 `params` 为 Promise 需 `await`，`getPersonalProjectBySlug` 为 null 时 `notFound()`）
- [ ] **Step 4: 确认通过 + 全量检查**：`pnpm test` PASS（设 `TEST_DATABASE_URL`）；`pnpm build && pnpm -r typecheck && pnpm lint` 绿
- [ ] **Step 5: Commit**：`feat(personal): add personal project crud with scoped slugs`

### Task 2: P-2 个人任务 / 子任务 / 评论服务与操作

**Files:**
- Create: `apps/web/src/features/personal/tasks/service.ts`、`apps/web/src/features/personal/tasks/actions.ts`、`apps/web/src/features/personal/tasks/components/NewTaskModal.tsx`、`apps/web/src/features/personal/tasks/components/SubtaskList.tsx`、`apps/web/src/features/personal/tasks/components/CommentBox.tsx`（后三个先按 P-4/P-3 需要 的最小可用实现）
- Test: `apps/web/src/features/personal/tasks/service.test.ts`

**Interfaces:**
- Consumes: Task 1 全部产出、`Task`/`Subtask`/`Comment`/`TaskStatus`/`getTaskProgress`（`@open-doing/types`）、schema 的 `tasks/subtasks/comments/projects`
- Produces（P-3/P-4 与 D 轨道消费）:
  - `export interface PersonalTaskInput { title: string; description?: string; dueDate?: string | null; projectId?: string | null }`
  - `createPersonalTask(userId: string, input: PersonalTaskInput, client?: DbClient): Promise<Task>`——`space_type='personal'`、`assignee_id=userId`、`status='todo'`；`projectId` 非空时断言该个人项目 `owner_id=userId`（否则 `DomainError`）；标题必填 1–200 字，`dueDate` 为 `YYYY-MM-DD` 或空
  - `listPersonalProjectTasks(userId: string, projectId: string, client?: DbClient): Promise<(Task & { subtasks: Subtask[] })[]>`——断言项目归属；按 `createdAt` 升序
  - `getPersonalTaskDetail(userId: string, taskId: string, client?: DbClient): Promise<TaskDetailModel | null>`——归属断言（`space_type='personal' AND assignee_id=userId`）不通过返回 null；`TaskDetailModel` 定义见 Task 4 契约（本任务先实现服务端组装：task 字段 + subtasks + comments（`authorName` 取 author 的 username）+ `projectName` + `progress`（`getTaskProgress({ status, subtasks })`）+ `assigneeName`）
  - `updatePersonalTask(userId: string, taskId: string, input: { title?: string; description?: string; dueDate?: string | null; status?: TaskStatus }, client?: DbClient): Promise<Task>`（状态仅经此手动流转；更新 `updatedAt`）
  - `deletePersonalTask(userId: string, taskId: string, client?: DbClient): Promise<void>`
  - `addPersonalSubtask(userId: string, taskId: string, title: string, client?: DbClient): Promise<Subtask>`、`removePersonalSubtask(userId, taskId, subtaskId)`、`togglePersonalSubtask(userId, taskId, subtaskId, completed)`——**toggle 只改 `completed` 与 `completedAt`，绝不改主任务 status**
  - `addPersonalComment(userId: string, taskId: string, content: string)`（1–2000 字）、`deletePersonalComment(userId, taskId, commentId)`（仅作者；个人任务恒为本人）
  - Server Actions（`"use server"`，均 `requireUser()` + `DomainError` → `ActionResult`）：`createPersonalTaskAction`、`updatePersonalTaskAction(taskId, input)`、`deletePersonalTaskAction(taskId)`、`addPersonalSubtaskAction(taskId, title)`、`togglePersonalSubtaskAction(taskId, subtaskId, completed)`、`removePersonalSubtaskAction(taskId, subtaskId)`、`addPersonalCommentAction(taskId, content)`、`deletePersonalCommentAction(taskId, commentId)`
  - `NewTaskModal`（`"use client"`，props `{ open; projects: { id: string; name: string }[]; defaultProjectId?: string | null; onSuccess: () => void; onCancel: () => void }`。文案逐字对照 `personal-project.html`「新建任务」弹窗——弹窗标题「新建任务」；「标题」（placeholder「任务要做什么？」）、「所属空间 / 项目」（选项 = 传入项目渲染为「个人空间 / <项目名>」+ 末项「个人空间 · 不属于项目」，默认选中 `defaultProjectId` 对应项，未传默认「不属于项目」）、「截止日期」（date 输入，可空）、「描述」（placeholder「补充背景、验收标准…」）；底部「取消」/「创建任务」；**无责任人字段**）
  - `SubtaskList`（props `{ subtasks: Subtask[]; onToggle: (subtaskId: string, completed: boolean) => Promise<void>; onAdd?: (title: string) => Promise<void>; onRemove?: (subtaskId: string) => Promise<void> }`——`onAdd`/`onRemove` 缺省时隐藏对应 UI，规格详见 Task 4）
  - `CommentBox`（props `{ comments: { id: string; authorId: string; authorName: string; content: string; createdAt: string }[]; currentUserId: string; onAdd: (content: string) => Promise<void>; onDelete?: (commentId: string) => Promise<void> }`，规格详见 Task 4）

- [ ] **Step 1: 写失败测试**（DB 套件，skipIf 约定）：创建（默认字段、`assignee=creator`、`spaceType='personal'`）；建到他人项目抛错；他人读详情/更新/删除 → null/`DomainError`；toggle 子任务后主任务 status 不变、`completedAt` 正确置/清；进度经 `getTaskProgress` 组装（3/5=0.6）；评论添加/作者删除；删除任务级联子任务与评论；他人项目任务列表为空
- [ ] **Step 2: 确认失败**：`pnpm test` → FAIL
- [ ] **Step 3: 实现**（service → actions → 三个组件按上方 props 与文案规格实现）
- [ ] **Step 4: 确认通过 + 全量检查**（同 Task 1 收尾命令）
- [ ] **Step 5: Commit**：`feat(personal): add personal tasks, subtasks and comments services`

### Task 3: P-3 个人项目页（列表 + 看板）

**Files:**
- Modify: `apps/web/src/app/(dashboard)/my/projects/[projectSlug]/page.tsx`（整体替换 Task 1 占位页）
- Create: `apps/web/src/features/personal/tasks/components/ProjectTaskTable.tsx`、`apps/web/src/features/personal/tasks/components/PersonalKanban.tsx`、`apps/web/src/features/personal/tasks/components/TaskRowActions.tsx`（行内状态切换/编辑/删除所需 client 件，可并入前两者）
- Modify（如需）: `features/personal/tasks/components/NewTaskModal.tsx`

**Interfaces:**
- Consumes: Task 1/2 全部产出、`StatusTag`/`ProgressBar`/`DueText`/`ConfirmModal`/`EmptyState`/`UserAvatar`（props 见 `components/ui/*` JSDoc）、`aggregateProjectProgress`/`isOverdue`/`isDueSoon`
- Produces: 页面路由 `(dashboard)/my/projects/[projectSlug]?view=list|board`（`view` 缺省 `list`；`searchParams` 为 Promise）

- [ ] **Step 1: 页面骨架**（对照 `personal-project.html`）：面包屑「个人空间 / <项目名>」（当前项加粗）；页头 h1 = 项目名，sub 逐字「个人项目 · 仅自己可见 · N 个任务」（N = 项目任务数；看板视图 sub 换为「拖动卡片即可改变任务状态（手动切换）」）；页头操作区从左到右：「编辑」「删除」文字按钮（编辑复用 Task 1 modal；删除 `ConfirmModal` 二次确认「删除后项目内任务一并删除」，成功 `router.push("/my")`）→ Segmented「列表 / 看板」（写 `?view=`，缺省 `list`）→ 主按钮「＋ 新建任务」弹 NewTaskModal（默认选中本项目）。项目描述不在页头展示（仅编辑弹窗可见）；原型页头无项目进度条，**不实现**；原型看板页 info callout（"拖放仅为原型演示"）是原型演示说明，**不实现**
- [ ] **Step 2: 列表视图 `ProjectTaskTable`**（`"use client"`，对照 `personal-project.html` 表格）：筛选栏 = 状态下拉「状态：全部 / 未开始 / 进行中 / 已完成」+ 排序下拉「排序：按截止日期（默认）/ 按状态 / 按创建时间」+ 右侧「共 N 条」；4 列**按原型顺序**——任务（标题链接，font-weight 500）｜状态（~96px，`StatusTag`）｜进度（~170px：有子任务 → `ProgressBar`（宽 110px）+ 下方「3/5 子任务 · 60%」；无子任务 →「无子任务，按状态计 50%」；已完成 →「—」）｜截止日期（~130px，`DueText`：临期「明天 10-22」样式，无 →「—」）——**无责任人列**；已完成行整行 opacity≈0.62 + 标题删除线；空项目 `EmptyState` 引导新建任务
- [ ] **Step 3: 看板视图 `PersonalKanban`**（`"use client"`，@dnd-kit，对照 `personal-project-board.html`）：三列「未开始 / 进行中 / 已完成」，列头 = 列名 + 数量徽标；仅「未开始」列头带「＋」新建任务按钮（对照原型）；卡片 = 标题；有子任务 → sm 进度条 + 底部「3/5」+ 截止（`DueText`）；无子任务 → 底部仅截止；已完成卡 opacity≈0.62 + 标题删除线 + `tag-done`。拖卡落列即调 `updatePersonalTaskAction` 改状态，**乐观更新失败回滚并 `message.error`**；375px 降级为单列（不要求拖拽，列内按钮切换状态）
- [ ] **Step 4: 新建任务弹窗**在项目页默认选中该项目
- [ ] **Step 5: 验证**：`pnpm dev -p 3001` + Playwright——建项目→建任务→勾子任务→列表/看板切换→拖卡改状态→删除任务（二次确认）；1440 与 375 无横向溢出
- [ ] **Step 6: 全量检查 + Commit**：`feat(personal): add personal project page with list and kanban views`

### Task 4: P-4 个人任务详情页 + 共享件 TaskDetailView

**Files:**
- Create: `apps/web/src/components/ui/task-detail/types.ts`、`apps/web/src/components/ui/task-detail/TaskDetailView.tsx`
- Create: `apps/web/src/app/(dashboard)/my/tasks/[taskId]/page.tsx`

**Interfaces（冻结契约，J-5 原样复用，逐字对齐 V1_TASKS P-4；唯一扩展为 `TaskDetailViewActions` 末尾两个**可选**成员，见代码块注释）:**
```ts
// types.ts
import type { Subtask, TaskStatus } from "@open-doing/types";

export interface TaskDetailComment {
  id: string;
  taskId: string;
  authorId: string;
  authorName: string;
  content: string;
  createdAt: string;
}

export interface TaskDetailModel {
  id: string;
  projectId: string | null;
  spaceType: "personal" | "team";
  title: string;
  description?: string;
  status: TaskStatus;
  assigneeId: string | null;
  assigneeName: string | null;
  dueDate?: string;            // YYYY-MM-DD
  createdAt: string;
  updatedAt: string;
  projectName: string | null;
  progress: number;            // 0~1，getTaskProgress 结果
  subtasks: Subtask[];
  comments: TaskDetailComment[];
}

export interface TaskDetailPermissions {
  canEdit: boolean;
  canDelete: boolean;
  canAssign: boolean;
}

export interface TaskDetailViewActions {
  toggleSubtask: (subtaskId: string, completed: boolean) => Promise<void>;
  updateStatus: (status: TaskStatus) => Promise<void>;
  updateTask: (input: { title: string; description?: string; dueDate?: string | null }) => Promise<void>;
  deleteTask: () => Promise<void>;
  addComment: (content: string) => Promise<void>;
  deleteComment: (commentId: string) => Promise<void>;
  // P 轨道对 V1_TASKS 契约的可选扩展：可选成员不破坏 J-5 的消费，
  // 补齐"子任务增删有 UI 入口"（服务层 P-2 已测）；INT-1 时与 J 轨道确认。
  addSubtask?: (title: string) => Promise<void>;
  removeSubtask?: (subtaskId: string) => Promise<void>;
}

export interface TaskDetailViewProps {
  task: TaskDetailModel;
  space: "personal" | "team";   // personal 时隐藏责任人选择器与管理员类控件
  permissions: TaskDetailPermissions;
  onAction: TaskDetailViewActions;
}
```
- `TaskDetailView`（`"use client"`，两栏布局对照 `task-detail.html`，个人态文案适配如下）：
  - 顶部：「← 返回项目」文字链接（页面传入返回地址，个人任务 → 所属项目页，无项目任务 → `/my`）；h1 任务标题；标题下 tag 行 = `StatusTag` + 临期/逾期 tag（「明天 10-22 到期」/「已逾期」样式，仅未完成任务显示）
  - 左列：描述段落（无描述 → 浅色占位「暂无描述」）；进度块「任务进度 · 3/5 个子任务」+「60%」（无子任务 →「无子任务，按状态计 50%」口径）；`section-title`「子任务 · 3/5」+ `SubtaskList`（勾选实时联动进度条，3/5=60%；`onAdd` 提供时底部「＋ 添加子任务」输入行，`onRemove` 提供时子任务项 hover 显示删除；原型未画此二者，功能必需）；`section-title`「评论 · N」（个人态**不加**原型「（全员可评论）」后缀）+ 评论列表（头像 + 作者 + 时间「MM-DD HH:mm」+ 内容；本人评论 hover 显示「删除」）+ 评论输入框（placeholder 逐字「写下你的评论…」+「取消」「发表评论」）
  - 右列 meta 卡片：状态（`StatusTag` +「更改」文字按钮 → 三态切换菜单调 `updateStatus`）；责任人（个人态：小头像 + 本人名，**无选择器**）；截止日期（「10-22 明天」+ 临期 tag「临期」；无 →「—」）；所属项目（链接）；创建人（「<创建人名> · YYYY-MM-DD 创建」）；分隔线；任务进度条 + caption 逐字「由 3/5 个子任务完成度自动计算」（无子任务 →「按任务状态自动计算」）；底部按钮列：主按钮「编辑任务」（`canEdit`，弹标题/描述/截止日期编辑表单调 `updateTask`）→「标记为已完成 / 标记为未完成」（按当前状态取反文案，调 `updateStatus`）→ 危险按钮「删除任务」（`ConfirmModal` 二次确认「删除后子任务与评论一并删除」+ `router.push` 离开）
  - 原型右列 info callout（"你是此任务的责任人……团队所有成员都可以发表评论"）是团队语境文案，个人态**不渲染**；团队态差异控件（责任人选择器、callout）本任务只留 `canAssign` 判断位，不实现团队选择器
- 页面：server 端 `requireUser()` → `getPersonalTaskDetail(userId, taskId)` → null 时 `notFound()`（不泄露存在性）；`permissions = { canEdit: true, canDelete: true, canAssign: false }`（个人空间）；client 包装件把 `onAction` 映射到对应 Server Actions 并在成功后 `router.refresh()`

- [ ] **Step 1: 定 types.ts + 实现 TaskDetailView**（对照原型逐区还原，props 逐字如上）
- [ ] **Step 2: 详情页 + client 包装件**（actions 失败 `message.error(errors.form)`）
- [ ] **Step 3: 验证**：Playwright——详情页全字段、勾选联动进度、状态切换、评论增删、编辑保存、删除回列表；直接访问不存在/他人的 taskId → 404
- [ ] **Step 4: 全量检查 + Commit**：`feat(personal): add personal task detail page and shared TaskDetailView`

### Task 5: P-5 侧栏个人段接入

**Files:**
- Modify: `apps/web/src/features/personal/components/PersonalNav.tsx`（**只改此桩文件**，不得改 dashboard layout）
- Create: `apps/web/src/features/personal/components/PersonalNavMenu.tsx`（`"use client"`：`usePathname` 高亮当前路由）
- 复用: `PersonalProjectFormModal`（新建项目入口）

**Interfaces:**
- Consumes: Task 1 `listPersonalProjects` / `createPersonalProjectAction`
- Produces: layout 零改动——`PersonalNav` 从服务端取数（`getCurrentUser()` 为 null 时渲染 null）后把数据交给 `PersonalNavMenu`。结构对照原型侧栏：顶部 `nav-item`「我的任务」（icon + →`/my`）；分组标题「个人项目」+ 每个项目一条 `nav-item sub`（文件夹 icon + 项目名，→`/my/projects/[slug]`，`usePathname` 当前路由高亮）；「新建项目」入口（V1_TASKS P-5 要求，原型未画）放分组标题行尾的「＋」文字按钮，弹 `PersonalProjectFormModal`，成功 `router.refresh()` 让侧栏即时出现新项目

- [ ] **Step 1: 实现**（保留原文件的 NavSection 分组结构与中文注释）
- [ ] **Step 2: 验证**：新建项目后侧栏即时出现；`/my` 与 `/my/projects/x` 高亮正确；375px 下侧栏隐藏无溢出
- [ ] **Step 3: 全量检查 + Commit**：`feat(personal): wire personal nav with projects and create entry`

### Task 6: P 轨道收尾

**Files:**
- Modify: `docs/V1_TASKS.md`（勾选 P-1~P-5 验收项、轨道表 P 行 ⬜→🟡）

- [ ] **Step 1: 诚实勾选**（只勾可验证项；`my/page.tsx` 聚合页属 D-1，不勾）
- [ ] **Step 2: 全量收尾**：`pnpm test`（DB 套件绿）+ `pnpm build` + `pnpm -r typecheck && pnpm lint`；Playwright 走查 P-1~P-5 出口（注册用户→建 2 个项目（含纯中文名）→建任务/子任务/评论→拖看板→详情→删除项目级联）
- [ ] **Step 3: Commit**：`docs: check off M1 personal space tasks`

---

## Self-Review 记录

- **Spec 覆盖**：V1_TASKS §6 P-1~P-5 验收逐条映射；§4 所有权矩阵遵守（个人任务服务自建、不改 features/tasks|projects、layout 不动、my/page.tsx 不碰）。
- **类型一致性**：`TaskDetailModel` 在 Task 2 由 service 组装、Task 4 定稿 types.ts——顺序上 Task 2 先在 service 侧定义同形结构、Task 4 落共享类型并复用；`ActionResult`/`DomainError`/`todayInShanghai` 均一次定义。
- **Review Focus 各项**已落测试或验证步骤。
- **比例**：签名、契约、测试断言 + 四个原型的逐字文案与结构规格；实现不再回读原型。
- **原型 vs 验收项裁决**（执行时记入 ledger）：① 原型项目页页头无编辑/删除按钮、无描述、无项目进度条，但 P-1 要求改名/删除——裁决放页头操作区文字按钮，描述仅编辑弹窗可见，进度条不实现；② 原型任务详情未画子任务增删入口，P-2 要求子任务增删——裁决为 `TaskDetailViewActions` 增加可选 `addSubtask`/`removeSubtask`（不破坏 J-5 消费，INT-1 确认）；③ 原型看板仅「未开始」列有「＋」按钮——照原型；④ 原型团队语境文案（callout、「全员可评论」后缀）个人态不渲染/去除；⑤ 原型看板页"拖放仅为原型演示" callout 是演示说明，不实现。
