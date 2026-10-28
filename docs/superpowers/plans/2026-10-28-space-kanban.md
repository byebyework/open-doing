# M3 空间级 Kanban 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 落地 M3 已定决策——个人/团队两个空间的空间级聚合看板(`/space/personal/kanban`、`/space/{teamSlug}/kanban`),三列、跨项目卡片、项目筛选(+团队未指派筛选)、拖拽改状态、done 列 7 天收敛 + 原地展开。

**Architecture:** 新领域模块 `features/kanban/`(service 聚合查询 + 共享 client 看板组件 + 展开用的取数 action);两个空间共用一套 `SpaceKanban` 组件,以 `variant` 区分;复用现有 `updatePersonalTaskAction`/`updateTeamTaskAction` 与 dnd-kit 拖拽模式(参照 `PersonalKanban`/`TeamKanban`,不重构它们);筛选状态进 URL query 由 RSC 读取后服务端过滤。

**Tech Stack:** Next.js 16 App Router(RSC + async searchParams)、React 19、@dnd-kit/core(已有依赖)、antd v6 + Tailwind 4、Drizzle + PostgreSQL 17、Vitest(串行)。

**Spec:** `docs/V1.1_TASKS.md` §M3 已定(2026-10-28)+ 原型 `docs/prototypes/space-kanban-personal.html` / `space-kanban-team.html`(视觉与文案基准,含 done 展开链接样式)。

## Global Constraints

- 全站中文文案;antd v6 组件优先,Tailwind 只做布局/微调,不用全局选择器覆盖 antd 内部样式。
- 日期口径:「今天」= `todayInShanghai()`(apps/web/src/lib/today.ts),RSC 计算后作 prop 传入 client 组件;`due_date` 为 Postgres `date`(JS 中字符串比较);「近 7 天」= `[today-6, today]`。
- Server Action 契约:`ActionResult<T>`(auth/actions.ts:19);每个 action 独立鉴权;状态流转复用现有 action,**不新建状态变更 action**。
- 权限:团队看板成员可见全部任务;编辑权沿用 `canEditTask({ role, actorId, assigneeId })`(features/tasks/permissions.ts:55)——视觉禁拖 + `handleDragEnd` 二次校验,缺一不可。
- 内部链接一律走 `apps/web/src/lib/routes.ts` builder,不写字面量 URL。
- 测试:vitest 串行(`fileParallelism: false`);DB 用例先 `set -a; source apps/web/.env.local; set +a`;e2e 端口 3100 / 独立库。
- commit message 英文,结尾 `Co-Authored-By: Claude Code <noreply@anthropic.com>`。

## Review Focus

- **排序口径**:非 done 列 = 逾期置顶(按截止升序)→ 其余按截止升序 → 无截止垫底;done 列按完成时间降序。排序错了看板就失去「哪里卡住」的信息——每个 service 测试必须断言完整顺序。
- **done 边界**:7 天窗口含今天(`updatedAt >= today-6`);展开 = 全量补充,不是再翻一页;「更早 N 项」计数必须等于 done 全量 − 近 7 天数,窗口两侧的卡都不能数错。
- **权限不泄露**:未指派任务对 member 不可拖不可改(现有语义);展开 action 与看板查询都必须校验团队成员资格,404 语义不泄露团队存在性。
- **筛选深链接**:带 `?project=x` / `?assignee=unassigned` 直接刷新/分享必须还原同一视图;非法 project slug 不得 500(回退全部)。
- **移动端可达**:非桌面端拖拽禁用但「任务状态按钮」可达,未指派筛选与展开在窄屏可操作。

---

### Task 1: 空间看板 service(个人侧)——类型 + 聚合查询(TDD)

**Files:**
- Create: `apps/web/src/features/kanban/service.ts`
- Test: `apps/web/src/features/kanban/service.test.ts`

**Interfaces:**
- Consumes: `tasks` 表(schema.ts:184,status text `$type<TaskStatus>`),`projects` 表,`todayInShanghai()`。
- Produces(后续任务消费,签名冻结):

```ts
export type SpaceType = "personal" | "team";
export interface KanbanCardItem {
  id: string;
  title: string;
  status: TaskStatus;
  dueDate: string | null;
  projectId: string;
  projectName: string;
  subtaskTotal: number;      // 子任务总数(SQL 聚合,参照 my-tasks service 的派生表模式)
  subtaskDone: number;
  completedAt: string | null; // 仅 done 卡有值:任务 updatedAt
}
export interface SpaceBoard {
  todo: KanbanCardItem[];
  inProgress: KanbanCardItem[];
  doneRecent: KanbanCardItem[];   // updatedAt ∈ 近 7 天(含今天)
  doneOlderCount: number;         // 更早已完成数(供展开链接)
  doneTotal: number;
}
export async function getPersonalSpaceBoard(userId: string, today: string): Promise<SpaceBoard>;
// 查询范围:spaceType='personal' AND assigneeId=userId 的全部任务,跨项目聚合
export async function getOlderDonePersonalTasks(userId: string, today: string): Promise<KanbanCardItem[]>;
// updatedAt < today-6 的全部已完成(供展开 action),排序同 done 列
```

- [ ] **Step 1: 写失败测试**(service.test.ts,fixtures:两个个人项目各若干任务)。断言:① 非done 列排序——逾期(10-01)→ 今天(10-21)→ 未来(10-25)→ 无截止;两条逾期按截止升序;② done 边界——`updatedAt = today-6` 在 doneRecent,`= today-7` 只进 doneOlderCount;③ doneRecent 按 updatedAt 降序,completedAt = updatedAt;④ doneOlderCount/doneTotal 数字正确(含 7 天窗口两侧);⑤ `status='done'` 且 `updatedAt` 在窗口内不进 todo/in_progress;⑥ 卡片带 projectName 与子任务计数(2/5)。
- [ ] **Step 2: 跑测试确认失败**(`set -a; source apps/web/.env.local; set +a; pnpm vitest run apps/web/src/features/kanban/service.test.ts`)。
- [ ] **Step 3: 实现 `getPersonalSpaceBoard` + `getOlderDonePersonalTasks`**。SQL 侧聚合:todo/in_progress/doneRecent 各一条查询(同 where 的 status 分支),doneOlderCount 用 count,子任务计数用派生表(参照 `features/dashboard/my-tasks/service.ts` 现有写法);排序在 SQL `order by`(逾期置顶 = `due_date asc` 即可覆盖——逾期的截止更早天然在前,无截止用 `nulls last`)。
- [ ] **Step 4: 跑测试确认通过**。
- [ ] **Step 5: Commit** `feat(kanban): personal space board aggregation service`

### Task 2: 空间看板 service(团队侧)

**Files:**
- Modify: `apps/web/src/features/kanban/service.ts`
- Modify: `apps/web/src/features/kanban/service.test.ts`

**Interfaces:**
- Produces:

```ts
export interface TeamKanbanCardItem extends KanbanCardItem {
  assigneeId: string | null;
  assigneeName: string | null;   // left join users
}
export interface TeamSpaceBoard {
  todo: TeamKanbanCardItem[];
  inProgress: TeamKanbanCardItem[];
  doneRecent: TeamKanbanCardItem[];
  doneOlderCount: number;
  doneTotal: number;
}
export async function getTeamSpaceBoard(teamId: string, today: string): Promise<TeamSpaceBoard>;
// 范围:team 全部项目任务(含未指派);调用方(页面)先做成员资格校验
export async function getOlderDoneTeamTasks(teamId: string, today: string): Promise<TeamKanbanCardItem[]>;
```

- [ ] **Step 1: 写失败测试**:① 个人侧全部断言在团队侧复跑(assigneeName 来自 join、未指派为 null);② 未指派任务在列且 assigneeId=null;③ 已移除成员的任务(assignee_id 置空)正常显示为未指派;④ 团队 A 的任务不混入团队 B。
- [ ] **Step 2: 失败 → 实现 → 通过**(查询结构与个人侧对称,`inArray(projects.teamId, [teamId])` + `spaceType='team'`)。
- [ ] **Step 3: Commit** `feat(kanban): team space board aggregation service`

### Task 3: 展开取数 Server Action

**Files:**
- Create: `apps/web/src/features/kanban/actions.ts`

**Interfaces:**
- Consumes: Task 1/2 的 `getOlderDone*`;`getCurrentUser()`/`requireUser()`;`getTeamBySlug` + `getMembership`(features/teams/service)。
- Produces(冻结):

```ts
export async function getOlderDoneTasksAction(input: { spaceType: "personal" } | { spaceType: "team"; teamSlug: string }):
  Promise<ActionResult<KanbanCardItem[]>>;
```

- [ ] **Step 1: 实现**:personal 分支 `requireUser()` → `getOlderDonePersonalTasks(user.id, todayInShanghai())`;team 分支 `getCurrentUser()` → `getTeamBySlug` + `getMembership`(不存在或非成员 → `notFound()` 语义不可用于 action,返回 `{ ok:false, errors:{ form:"没有权限查看该团队" } }`);today 在 action 内计算(日期口径单一来源)。
- [ ] **Step 2: service.test.ts 补 action 级用例**:未登录 team 分支返回 ok:false;非成员同;成员返回按序卡片。(action 直接调用,不起服务器。)
- [ ] **Step 3: 跑测试通过 + Commit** `feat(kanban): older-done fetch action with membership guard`

### Task 4: SpaceKanban 共享组件(client)

**Files:**
- Create: `apps/web/src/features/kanban/components/SpaceKanban.tsx`

**Interfaces:**
- Consumes: Task 1/2 的 board 类型;`updatePersonalTaskAction(taskId,{status})`、`updateTeamTaskAction(taskId,{teamId,status})`;`canEditTask`;`personalTaskHref(taskId)`/`teamTaskHref(teamSlug,projectSlug,taskId)`(routes.ts);`getOlderDoneTasksAction`。
- Produces: props(冻结):

```ts
export interface SpaceKanbanProps {
  variant: "personal" | "team";
  board: SpaceBoard | TeamSpaceBoard;   // 已按 URL 筛选过滤
  projects: { id: string; name: string; slug: string }[];
  today: string;
  // team 专有
  teamId?: string; teamSlug?: string; role?: TeamRole; actorId?: string;
  taskHrefs: Record<string, string>;    // taskId → 详情页 href(RSC 用 builder 生成)
}
```

- [ ] **Step 1: 组件骨架**:`"use client"`;渲染期同步 props→state(`if (props.board !== syncedBoard)` 模式);`useIsDesktop()`(从 PersonalKanban.tsx:51-82 提取为 `features/kanban/components/useIsDesktop.ts` 并让 PersonalKanban/TeamKanban 改为引用——行为不变,删除各自内联副本);DndContext + PointerSensor(distance:6)+ KeyboardSensor,droppable id = 状态字符串。
- [ ] **Step 2: 卡片渲染**(对照原型):meta 行 = 项目 tag(team 紫 `bg-[rgba(155,135,245,0.14)] text-[#6d4fd4]` / personal 薄荷 `bg-[rgba(72,201,151,0.12)] text-[#1f9d78]`)+ spacer + 「子任务 x/y」(0 总数不显示);标题链接到 `taskHrefs[id]`;foot = 负责人(团队:`UserAvatar`+名,未指派 `<Tag>未指派</Tag>` 灰;个人:无)+ 截止(复用文案口径:逾期红「MM-DD · 已逾期 N 天」/ 今天黄「今天到期」/ 明天黄「明天到期」/ 未来灰「MM-DD」/ 无「—」)。done 卡整体降透明 + 「MM-DD 完成」。
- [ ] **Step 3: 拖拽与乐观更新**:复制 PersonalKanban 的 handleDragEnd 模式(本地列状态迁移 → 调对应 action → 失败回滚 + `message.error`);`draggable = isDesktop && canEdit`(personal 恒可拖,team 用 `canEditTask({ role, actorId, assigneeId })`);拖拽只改 status 不改 projectId;`handleDragEnd` 内二次 `canEditTask` 校验(member 拖他人/未指派卡静默返回)。
- [ ] **Step 4: 移动端降级**:<861px 单列堆叠 + 卡内「任务状态按钮」(antd Button 组,参照 PersonalKanban TaskStatusButtons),权限同拖拽。
- [ ] **Step 5: 列头与筛选联动**:列头计数(过滤后集合);todo/in_progress 列头逾期计数(红 `count is-error` 样式);done 列头「本周完成」计数(= doneRecent 中 updatedAt ≥ 本周一,`getWeekStart` 复用 my-tasks);done 尾部 `doneOlderCount > 0` 时渲染链接「查看更早 N 项已完成 →」+ 灰字「点击原地展开全部已完成任务,可再次收起」。
- [ ] **Step 6: done 原地展开**:本地 state `expanded`;点击调 `getOlderDoneTasksAction`,成功把返回卡片并入 done 列尾,链接变「已显示全部 N 项 · 收起」(点击收起恢复 7 天视图);失败 `message.error("加载失败,请重试")` 且不动现有数据;展开状态不进 URL。
- [ ] **Step 7: 验证**:`pnpm typecheck` + `pnpm build` 绿(组件本任务不接页面,先保证可编译;交互正确性由 Task 6 的 e2e 与现有 kanban 模式背书)。
- [ ] **Step 8: Commit** `feat(kanban): shared space kanban board component`

### Task 5: 两个看板页面 + 占位页收缩

**Files:**
- Create: `apps/web/src/app/(dashboard)/space/personal/kanban/page.tsx`
- Create: `apps/web/src/app/(dashboard)/space/[teamSlug]/kanban/page.tsx`
- Modify: `apps/web/src/app/(dashboard)/space/[teamSlug]/[module]/page.tsx`(MODULE_LABELS 移除 `kanban`)
- Modify: `apps/web/src/features/personal/tasks/components/PersonalKanban.tsx` + `apps/web/src/features/tasks/components/TeamKanban.tsx`(仅改 useIsDesktop 引用,Task 4 带动)

**Interfaces:**
- Consumes: Task 4 组件;`listPersonalProjects(userId)`;`listTeamProjects(teamId)`;`listMyTaskStats` 无关。
- Produces: URL query 契约(冻结):`?project={projectSlug}`(两空间)、`?assignee=unassigned`(仅团队);无参数 = 全部。

- [ ] **Step 1: 个人页**:RSC;`requireUser()`;`searchParams`(Next 16 async Promise)读 `project`/无;`Promise.all(getPersonalSpaceBoard, listPersonalProjects)`;project 参数按 slug 匹配(`getPersonalProjectBySlug`,不匹配或非本人 → 忽略参数回退全部,不 500);服务端按 project 过滤列数据;`taskHrefs` 用 `personalTaskHref` 构建;`metadata.title = "Kanban · Open Doing"`;页头 h1「Kanban」+ sub「个人项目的任务全景:全部个人任务跨项目聚合,拖拽卡片即可切换状态。」+ 页头「新建任务」按钮(复用 NewTaskButton 的个人变体,弹窗选项目——若现有弹窗强绑项目页,则本任务先渲染入口按钮链接到最近的个人项目页,实现时报告实际做法)。
- [ ] **Step 2: 团队页**:RSC;`getTeamBySlug` + `getMembership` → 不存在或非成员 `notFound()`(不泄露存在性);`?project=`/`?assignee=unassigned` 服务端过滤(assignee 筛选只作用于列内过滤,计数同步);`taskHrefs` 用 `teamTaskHref`;`metadata.title = "{team.name} Kanban · Open Doing"`;筛选条 = 项目 Select(antd,受控 `router.push` 写 query,参照 TaskRowActions 的 `?view=` 先例)+ 「全部任务/未指派」 Segmented;sub 文案照原型。
- [ ] **Step 3: 占位页收缩**:MODULE_LABELS 移除 `kanban`(两个真实路由现在遮蔽它);确认 `/space/personal/calendar` 等仍 404 到占位页。
- [ ] **Step 4: 验证**:`pnpm --filter @open-doing/web exec next typegen && pnpm typecheck && pnpm build` 绿;全量 `pnpm vitest run` 绿。
- [ ] **Step 5: Commit** `feat(kanban): space kanban pages with url filter state`

### Task 6: e2e + 文档收尾

**Files:**
- Create: `apps/web/e2e/flows/06-space-kanban.spec.ts`
- Modify: `docs/ARCHITECTURE.md` §5(kanban 路由 + URL query 契约)、§12 现状表
- Modify: `docs/V1.1_TASKS.md` §M3 标 ✅ + 实现记录(useIsDesktop 提取、展开 action、URL 契约)

- [ ] **Step 1: e2e 流 06**:登录 → `/space/personal/kanban` 断言三列与卡片项目 tag;`?project=` 深链接刷新还原;切「未指派」筛选(团队看板);状态切换用移动端按钮路径(375px 视口点状态按钮,断言列计数变化——dnd-kit 拖拽在 e2e 不稳定,不测拖拽本体,拖拽逻辑由现有项目看板回归覆盖);done「查看更早」点击后计数收起可逆。跑 `pnpm --filter @open-doing/web test:e2e` 全绿。
- [ ] **Step 2: 文档更新**(ARCHITECTURE §5/§12、V1.1_TASKS §M3 ✅ + 实现记录,含留白项落定:URL 参数名 `project`/`assignee`、空态文案「这个空间还没有任务,去 Dashboard 或项目页创建第一项任务。」)。
- [ ] **Step 3: Commit** `test(e2e): add space kanban flow and finalize M3 docs`
