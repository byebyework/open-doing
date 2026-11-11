# 任务列表操作列 + 优先级 + 全站绝对日期 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 任务列表用显式操作列 + 可点状态徽标替代「⋯」下拉;任务新增三档优先级并贯穿表单/列表/看板/详情;全站日期显示统一为 `YYYY-MM-DD`(时间戳 `YYYY-MM-DD HH:mm`),去除「今天/明天」相对日期文案。

**Architecture:** 优先级是 `tasks.priority` 列(NOT NULL DEFAULT 'medium')+ `packages/types` 的 `TaskPriority`;显示层所有日期收敛到新的 `apps/web/src/lib/date-display.ts` 纯函数;两个 RowActions 文件重构为操作列组件,状态切换移入状态列徽标的 Radix DropdownMenu;排序比较函数抽到 `apps/web/src/lib/task-sort.ts` 供两个表格复用。

**Tech Stack:** Next.js 16 App Router、Drizzle + PostgreSQL 16、next-intl(zh/en)、vendored shadcn/ui(Radix)、Vitest + Playwright。

**Spec:** `docs/superpowers/specs/2026-11-11-task-list-actions-priority-dates-design.md`(绑定权威,决策 D1–D14)

## Global Constraints

- 所有 UI 文案进 `apps/web/src/i18n/messages/{zh,en}.json`,两目录 key 结构一致(cjk-guard / messages-parity 必须绿)。
- 颜色用 token CSS 变量(`var(--status-overdue)` 等),不写新 hex(记忆约定的 `#a66b00`/`#0e9ba3` 等既有例外除外)。
- 「今天」永远是 `todayInShanghai()`(Asia/Shanghai),组件收 `today: string` prop,不取本地时区。
- 优先级修改复用既有 `updatePersonalTaskAction` / `updateTeamTaskAction`,不新增 action;权限链不动。
- 迁移空库可回放;`TEST_DATABASE_URL` 不得指向 dev 库;vitest/drizzle-kit 前先 `set -a; source apps/web/.env.local; set +a`。
- 提交信息:英文 Conventional Commits,正文可用中文注释说明,结尾 `Co-Authored-By: Claude Code <noreply@anthropic.com>`。
- 通知模板「今日/明日」措辞**不改**;`NotificationBell` 的 `fromNow()` 保留;日历「今天」按钮/今日徽标、统计卡文案、星期表头、`基准日期` 行保留。

## Review Focus

- **优先级往返**:创建时选「高」→ 详情改「低」→ 列表/看板/详情一致显示「低」(Task 2 service DB 测试 + Task 5 组件层)。
- **非法优先级**:action 直调传 `"urgent"` 之类必须被 service 拒绝(field=priority),不得落库(Task 1 纯函数 + Task 2 service 测试)。
- **member 权限**:member 打开团队列表,状态徽标禁用、删除图标不渲染、编辑图标可见(Task 4 组件结构 + Task 8 e2e)。
- **排序平局**:同优先级 + 同截止日期按创建时间稳定序;无截止日期排同级最后(Task 3 比较函数单测)。
- **畸形日期**:`dueDate` 非 `YYYY-MM-DD` 时显示原样不崩溃、不产出 `Invalid Date`(Task 3 单测)。

---

### Task 1: 类型 + 迁移 + 优先级校验纯函数

**Files:**
- Modify: `packages/types/src/index.ts`(TaskStatus 旁加类型;Task 接口 :121 加字段)
- Modify: `packages/types/src/index.test.ts`
- Modify: `apps/web/src/server/db/schema.ts`(tasks 表 :305 附近)
- Modify: `apps/web/src/lib/task-fields.ts`(validateTaskStatus :127 旁)
- Test: `apps/web/src/lib/task-fields.test.ts`(已存在则追加,否则新建)
- Generate: `apps/web/drizzle/<new>_task_priority.sql`(db:generate 产出)

**Interfaces:**
- Produces: `export type TaskPriority = "low" | "medium" | "high"`;`export const TASK_PRIORITIES: readonly TaskPriority[]`(顺序 low→high);`export const TASK_PRIORITY_ORDER = TASK_PRIORITIES`(语义别名,排序用);`Task` 接口新增 `priority: TaskPriority`;`validateTaskPriority(value: unknown): TaskPriority`(非法抛 `DomainError("任务优先级不合法", "priority", { key: "priorityInvalid" })`)。

- [ ] **Step 1: 写失败测试** — types 测试:`TASK_PRIORITIES` 深等于 `["low","medium","high"]`;task-fields 测试:`validateTaskPriority("high")==="high"`、`validateTaskPriority("urgent")` 抛 DomainError 且 `field==="priority"`。
- [ ] **Step 2: 跑测试确认失败**(Expected: 导出不存在 / TS 报错;vitest 不查类型,类型面以 `pnpm exec tsc --noEmit`(在 apps/web 下)确认)。
- [ ] **Step 3: 实现** — types 加类型/常量/`Task.priority`;schema 加 `priority: text("priority").$type<TaskPriority>().notNull().default("medium")`;task-fields 加 `validateTaskPriority`(照 `validateTaskStatus` 同型);`errors` ns 补 `priorityInvalid`(zh:「任务优先级不合法」/ en:"Invalid task priority")。
- [ ] **Step 4: `pnpm db:generate` 生成迁移;`pnpm vitest run` 相关两文件 PASS;tsc --noEmit 0 错。**
- [ ] **Step 5: Commit** — `feat(tasks): add task priority field and validation`

### Task 2: service/action 层贯通 priority(个人 + 团队)

**Files:**
- Modify: `apps/web/src/features/personal/tasks/service.ts`(`PersonalTaskInput` :31、create/update 写入、`toTask` 行映射)
- Modify: `apps/web/src/features/tasks/service.ts`(:361 `input.status !== undefined` 旁镜像 priority 分支;create/toTask 映射)
- Modify: `apps/web/src/features/personal/tasks/actions.ts`(update input :74 加 `priority?: TaskPriority`)
- Modify: `apps/web/src/features/tasks/actions.ts`(create :53 / update :74 input 加 `priority?: TaskPriority`)
- Test: `apps/web/src/features/personal/tasks/service.test.ts`、`apps/web/src/features/tasks/service.test.ts`(追加用例)

**Interfaces:**
- Consumes: Task 1 的 `validateTaskPriority`、`TaskPriority`。
- Produces: 创建/更新链路接受 `priority?: TaskPriority`;undefined = 不改;行映射后的 `Task.priority` 恒有值(默认 medium)。`TaskDetailClient` / `TeamTaskDetailClient` 透传不新增分支。

- [ ] **Step 1: 写失败 DB 测试** — personal:创建传 `priority:"high"` → 返回与 `getPersonalTask` 均为 high;更新传 `priority:"low"` → 落库 low;不传 priority 的更新不改变既有值;非法值 rejects DomainError(field=priority)。team:`createTeamTask` 带 priority + `updateTeamTask` 改 priority 各一例。
- [ ] **Step 2: 跑测试确认失败**(`pnpm vitest run <两文件>`,Expected: 断言失败,非报错)。
- [ ] **Step 3: 实现** — service 校验(`input.priority !== undefined` 时 `validateTaskPriority`)、insert/update 列、`toTask` 映射补 `priority: row.priority`;actions input 类型加字段透传。
- [ ] **Step 4: `pnpm vitest run` 两文件 PASS。**
- [ ] **Step 5: Commit** — `feat(tasks): persist task priority through personal and team services`

### Task 3: 日期显示库 + DueText 重写 + 排序比较函数

**Files:**
- Create: `apps/web/src/lib/date-display.ts`
- Create: `apps/web/src/lib/date-display.test.ts`
- Create: `apps/web/src/lib/task-sort.ts`
- Create: `apps/web/src/lib/task-sort.test.ts`
- Modify: `apps/web/src/components/ui/DueText.tsx`(重写)

**Interfaces:**
- Produces: `formatTaskDate(date: string): string` — `\d{4}-\d{2}-\d{2}` 命中则原样返回,否则原样返回(不抛、不格式化,保证畸形输入显示原文);`formatTaskTimestamp(value: string | Date): string` — dayjs `format("YYYY-MM-DD HH:mm")`。`compareByPriority(a: PrioritySortInput, b: PrioritySortInput): number` — `PrioritySortInput = { priority: TaskPriority; dueDate?: string | null; createdAt: string }`;规则:优先级高在前(`TASK_PRIORITY_ORDER` 索引差取反)→ dueDate 升序、null/undefined 用 `"9999"` 哨兵排最后 → `createdAt` 字符串升序。`DueText` 新渲染:逾期红「已逾期 · {formatTaskDate(dueDate)}」(`date.overdueWithDate`,参数改传完整日期)、临期黄纯日期、普通灰纯日期;删除组件内 `shortDate`;不再使用 `date.today` / `date.tomorrow`。

- [ ] **Step 1: 写失败测试** — date-display:`formatTaskDate("2026-10-22")==="2026-10-22"`、`formatTaskDate("garbage")==="garbage"`、`formatTaskTimestamp(new Date(Date.UTC(2026,9,22,2,30)))==="2026-10-22 10:30"`(Asia/Shanghai);task-sort:高→低、同优先级同日期按 createdAt、无日期同级最后。
- [ ] **Step 2: 跑测试确认失败**(Expected: 模块不存在)。
- [ ] **Step 3: 实现两个纯函数模块 + 重写 DueText**(DueText 无独立测试文件,行为由 Task 8 e2e 与既有引用编译保证;`isOverdue`/`isDueSoon` 判定与 `today` prop 机制不变)。
- [ ] **Step 4: 两测试文件 PASS;`pnpm exec tsc --noEmit` 在 apps/web 下 0 错(DueText 引用方无签名变化)。**
- [ ] **Step 5: Commit** — `refactor(ui): absolute date display helpers and priority sort comparator`

### Task 4: 列表操作列 + 可点状态徽标 + 优先级列(两个表格)

**Files:**
- Modify: `apps/web/src/features/personal/tasks/components/TaskRowActions.tsx`(去下拉;保留 `TASK_STATUS_ORDER`/`TASK_STATUS_KEYS`/`ProjectTask`/`TaskStatusButtons`/`PersonalProjectPageActions` 导出)
- Modify: `apps/web/src/features/tasks/components/TeamTaskRowActions.tsx`(同型;保留 `TEAM_TASK_STATUS_ORDER` 等导出)
- Modify: `apps/web/src/features/personal/tasks/components/ProjectTaskTable.tsx`
- Modify: `apps/web/src/features/tasks/components/TeamProjectTaskTable.tsx`
- Test: `apps/web/src/lib/task-sort.test.ts`(已存在,补表格接线由 tsc 保证)

**Interfaces:**
- Consumes: Task 1 `TaskPriority`、Task 2 `Task.priority`、Task 3 `compareByPriority`/`formatTaskDate`。
- Produces: 行结构变化 —— 两个表格列序 任务/优先级(72px chip)/状态/(团队:责任人)/进度/截止日期/操作;状态单元格改为 `DropdownMenu`(trigger = 原徽标加 `▾`,menu 三态,当前态高亮,`!editable` 时 trigger disabled);操作单元格 = 编辑铅笔(所有人可见,`router.push(detailHref)`)+ 删除垃圾桶(仅 `canDeleteTask`,danger hover);行尾「⋯」触发器删除。`SortKey` 增加 `"priority"`,排序下拉加选项(`tasks.sortPriority`),comparator 换 `compareByPriority`(dueDate/status/createdAt 选项保留原比较)。
- 优先级 chip 组件:`PriorityChip({ priority }: { priority: TaskPriority })` 放在 `apps/web/src/components/ui/PriorityChip.tsx`(色点 + 文字,色值:`high`→`var(--status-overdue)`、`mid`→`#a66b00`/点 `#f0a01e`、`low`→`var(--ink-400)`/点 `#c3c8cf`;参照原型 `.pri` 样式)。

- [ ] **Step 1: 写失败组件测试** — 仿 `ProjectStatsCard.test.tsx` 的 jsdom + act 探针,新建 `apps/web/src/features/personal/tasks/components/ProjectTaskTable.test.tsx` 断言:渲染含 `data-testid="priority-chip"`、不含 `rowActionsAria` 对应的「⋯」按钮 aria、含操作列表头文案。团队侧由 TeamKanban.test.ts 既有用例 + tsc 保护。
- [ ] **Step 2: 跑测试确认失败**(Expected: 页面仍渲染旧结构)。
- [ ] **Step 3: 实现** — PriorityChip → 两个 RowActions 重构 → 两个表格改列/接 sort/接 menu;i18n 加 `tasks.priority`("优先级"/"Priority")、`priorityLow/Medium/High`、`sortPriority`("按优先级"/"By priority")、`opsColumn`("操作"/"Actions")、`statusMenuAria`("更改状态:{title}")、`editTaskAria`("编辑任务:{title}")、`deleteTaskAria`("删除任务:{title}");删孤儿 key `tasks.markAs`、`tasks.rowActionsAria`(zh/en 同步)。
- [ ] **Step 4: 组件测试 PASS;`pnpm vitest run apps/web/src/features apps/web/src/lib` 全绿。**
- [ ] **Step 5: Commit** — `feat(tasks): explicit actions column with clickable status badge and priority column`

### Task 5: 四个表单入口 + 详情页优先级

**Files:**
- Modify: `apps/web/src/features/personal/tasks/components/NewTaskModal.tsx`
- Modify: `apps/web/src/features/tasks/components/NewTeamTaskModal.tsx`
- Modify: `apps/web/src/features/dashboard/my-tasks/components/NewTaskModal.tsx`
- Modify: `apps/web/src/components/ui/task-detail/TaskDetailView.tsx`(优先级行 + 本文件日期渲染按 Task 7 规则一并改)
- Test: 复用各 modal 既有测试(如有)断言默认值 medium;`TaskDetailView.test.tsx` 追加优先级行断言

**Interfaces:**
- Consumes: Task 2 action input 的 `priority`、Task 4 的 `PriorityChip` 与 `priorityLow/Medium/High` 文案。
- Produces: 表单 Select 必选、默认 `medium`,提交携带 priority;详情页元信息「优先级」行(状态行后)展示 `PriorityChip`,编辑态为 Select;详情页日期文案改绝对日期(`dueTodayFull`/`dueTomorrowFull` 与 `shortDate` 用法移除)。

- [ ] **Step 1: 写失败测试** — `TaskDetailView.test.tsx`:传 `task.priority="high"` 渲染含「高」;无该行前断言失败。modal 若有测试文件,补「默认选中 中」断言;没有则手测路径并入 Task 8 e2e。
- [ ] **Step 2: 跑测试确认失败。**
- [ ] **Step 3: 实现** — 四个表单加 Select(label `tasks.priority`);TaskDetailView 加元信息行与编辑字段,日期显示换 `formatTaskDate`。
- [ ] **Step 4: 相关测试 PASS。**
- [ ] **Step 5: Commit** — `feat(tasks): priority selector across task forms and detail page`

### Task 6: 三个看板的优先级色点

**Files:**
- Modify: `apps/web/src/features/personal/tasks/components/PersonalKanban.tsx`
- Modify: `apps/web/src/features/tasks/components/TeamKanban.tsx`(`TeamKanban.test.ts` 的 `makeTask` 夹具补 `priority`)
- Modify: `apps/web/src/features/kanban/components/SpaceKanban.tsx`(本文件日期渲染按 Task 7 规则一并改)

**Interfaces:**
- Consumes: `PriorityChip` 的色点变体 —— 组件导出 `PriorityDot({ priority }: { priority: TaskPriority })`(仅色点,外层 `title={档位文案}`)。
- Produces: 卡片底部(kc-foot 对应位置)渲染色点;列内排序不变。

- [ ] **Step 1: 失败测试** — `TeamKanban.test.ts` 追断言:卡片渲染 `data-testid="priority-dot"`。
- [ ] **Step 2: 确认失败。**
- [ ] **Step 3: 实现 PriorityDot + 三个看板接入。**
- [ ] **Step 4: `pnpm vitest run apps/web/src/features/tasks apps/web/src/features/personal` PASS。**
- [ ] **Step 5: Commit** — `feat(kanban): priority dot on task cards`

### Task 7: 全站日期扫描收敛(六个 shortDate + 时间戳 + 图表)

**Files:**
- Modify: `apps/web/src/components/ui/task-detail/TaskDetailView.tsx`(若 Task 5 未尽)、`apps/web/src/features/kanban/components/SpaceKanban.tsx`(若 Task 6 未尽)、`apps/web/src/features/dashboard/personal-dashboard/components/TodayTaskList.tsx`(「今天到期」徽标改完整日期,徽标样式保留)、`apps/web/src/features/dashboard/team-dashboard/components/MilestoneList.tsx`、`apps/web/src/features/calendar/components/SpaceCalendar.tsx`(侧栏 weekRange/周分组标签;「今天」按钮与今日徽标不动)、`apps/web/src/features/personal/tasks/components/CommentBox.tsx`(`MM-DD HH:mm` → `formatTaskTimestamp`)、`apps/web/src/app/(dashboard)/invites/page.tsx`、`apps/web/src/app/(dashboard)/space/[teamSlug]/settings/page.tsx`(`MM-DD HH:mm` → 完整)、`apps/web/src/features/teams/components/MemberList.tsx`(joinedAt)、`apps/web/src/features/teams/joins/components/JoinRequestList.tsx`、`apps/web/src/features/analysis/buckets.ts`(:72 轴标签)、`apps/web/src/features/analysis/components/SpaceAnalysis.tsx`(:457/:645 悬浮文案)
- Test: 既有单测中钉住旧文案的用例随改随修(RED→GREEN)

**Interfaces:**
- Consumes: Task 3 `formatTaskDate` / `formatTaskTimestamp`。
- Produces: 全站 `grep -rn 'MM-DD' apps/web/src` 无格式化调用;`grep -rn 'shortDate' apps/web/src` 仅剩 date-display.ts 内部实现(或 0 处);「今天/明天」仅存于:日历按钮/徽标、统计卡文案、通知模板、`NotificationBell` fromNow。

- [ ] **Step 1: 逐文件替换为共享函数;文案类 i18n key(`dueTodayFull`/`dueTomorrowFull`/`dueOverdueBadge`/`overdueShort`/`dueToday`/`dueTomorrow` 等)按引用清点:无引用即删(zh/en 同步),仍被日历/详情引用的保留。**
- [ ] **Step 2: `pnpm vitest run` 修红至绿(钉旧文案的用例改断言完整日期)。**
- [ ] **Step 3: `grep` 双检查输出贴进提交说明。**
- [ ] **Step 4: Commit** — `refactor(i18n): unify all date rendering to absolute yyyy-MM-dd`

### Task 8: e2e 同步 + 全量回归

**Files:**
- Modify: `apps/web/e2e/flows/07-space-calendar.spec.ts`(:92 侧栏标签断言改完整日期)
- Modify: `apps/web/e2e/flows/08-space-analysis.spec.ts`(:241 悬浮断言改完整日期)
- Modify: `apps/web/e2e/utils/testids.ts`(补 `priorityChip`/`priorityDot`/`prioritySelect` 等)
- Modify: `apps/web/e2e/flows/13-projects-module.spec.ts` 或新 flow(优先级往返:建任务选高 → 详情改低 → 列表 chip 变低;member 权限断言)
- Modify: `apps/web/src/i18n/cjk-guard.test.ts`(新 e2e 中文断言白名单条目)

**Interfaces:**
- Consumes: Task 4–7 的 testid 与文案。

- [ ] **Step 1: 改/增 e2e;停 dev server(Next 16 同目录锁)后 `pnpm --filter @open-doing/web test:e2e -- flows/07-space-calendar.spec.ts flows/08-space-analysis.spec.ts` 及新增 flow PASS。**
- [ ] **Step 2: 全量回归:`pnpm lint`、`pnpm test`(先 source .env.local)、`pnpm --filter @open-doing/web exec next typegen` + `pnpm typecheck`,全绿。**
- [ ] **Step 3: Commit** — `test(e2e): update date assertions and add priority flow`
- [ ] **Step 4: 原型一致性人工核对:列表页对照 `personal-project.html` / `project-list.html`,详情页对照 `task-detail.html`。**
