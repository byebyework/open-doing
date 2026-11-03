# antd → shadcn/ui 迁移 Plan 2:模块渐进迁移与清场

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 apps/web 剩余 54 个 antd 消费文件按模块迁到 shadcn/ui,并新增看板统计带(Phase 0 进 app),最后清场移除 antd。

**Architecture:** 共享原子件(StatusTag/ProgressBar/ConfirmModal)先内部换芯(公开 props 不变),随后按 teams → task-detail → personal → users/notifications → dashboard+kanban → 统计带 → team tasks/projects → AppShell 布局件 → calendar 逐模块迁移(顺序即风险从低到高),每模块合并后应用完整可用;清场任务重写根 Providers、移除 antd、开启 preflight 并做全局视觉审计。

**Tech Stack:** Next.js 16 App Router + RHF/zod/@hookform/resolvers + shadcn vendored 组件(components/ui/shadcn,Plan 1 已就位)+ sonner + react-day-picker/date-fns(仅 calendar)。

**Spec:** docs/superpowers/specs/2026-11-02-antd-to-shadcn-migration-design.md(本计划实现其 Phase 2 模块迁移与清场;Phase 0 原型已在 Plan 1 完成,Task 7 把统计带按原型口径进 app)。

## Global Constraints(引自 spec,逐条对任务隐式生效)

- 验收线:**令牌 + 组件形态 + 文案一致**;stock shadcn/Radix 默认差异(动画曲线、select 箭头字形、焦点环渲染)不在验收范围,不为像素一致定制组件。能用原生组件就不定制。
- 迁移全程可日常使用:每任务合并后全量测试绿、应用完整可用。
- **不改后端**:schema、Server Action 签名、权限判断不动。唯一例外:Task 7 看板 service 筛选类型的**只读扩展**。
- e2e 断言不改(选择器语义不变、全部 data-testid 保留);新增覆盖允许;若必须改断言,升级为提交说明中记录理由。
- 文案零硬编码:新文案必须进 `src/i18n/messages/{zh,en}.json` 双目录(cjk-guard + messages-parity 强制);现有文案键沿用,不新造。
- tokens.css **零改动**(与 design-tokens.css 1:1);radius 一律 `rounded-[var(--radius-N)]` 任意值(Plan 1 裁定:@theme 不映射 radius)。
- 拖拽实现(SpaceKanban/PersonalKanban/TeamKanban)保持 dnd-kit 现实现,**只换渲染层**,sensors/keys/回调逻辑不动。
- 日期输入继续原生 `input type=date`;「今天」一律 `lib/today.ts`(Asia/Shanghai),组件内不取本地时区。
- e2e 前停 dev server(Next 16 同目录锁);vitest 用字面量 env 前缀(`TEST_DATABASE_URL` 等四件套)。
- 每任务完成定义:该模块页面与原型一致、该模块 antd import 清零、`pnpm build && pnpm typecheck && pnpm lint` + 全量 vitest 绿 + 相关 e2e 绿。

## 转换惯例(所有任务引用,不再重复)

1. **message → sonner toast**:`App.useApp()` 的 `message` 全部替换为 `import { toast } from "sonner"` 的 `toast.success/error(...)`(纯函数,无需 hook);删除该文件的 `App` import 与 `App.useApp()` 调用。提示语义(success/error/info)一一对应。
2. **Form → RHF**(Plan 1 auth 既有模式,zod schema 组件内构建、文案取 next-intl):`useForm` + `zodResolver`;字段错误渲染 `<p id="{formId}-{field}-error" className="text-[12.5px] text-[var(--error)]">`,输入带 `aria-invalid` 与 `aria-describedby`;action 返回 `ok:false` 时调 `applyActionErrors(result.errors, { setFieldError, onFormError })`(`@/lib/action-form`);form 级错误用 shadcn `Alert variant="destructive"`;提交中按钮 `disabled` + `Loader2Icon className="animate-spin"`;**保留全部 data-testid、autoComplete、autoFocus**;label 用 shadcn `Label htmlFor`。
3. **Modal → Dialog**(受控):`<Dialog open={open} onOpenChange={setOpen}><DialogContent>`;标题用 `DialogTitle`;原 Modal 表单内 form 级 Alert 保留。
4. **二次确认**:一律复用 `ConfirmModal`(Task 1 已换 AlertDialog 芯),**不**直接使用 antd `Modal.confirm`。
5. **Select → shadcn Select**:受控 `value`/`onValueChange`;`data-testid` 放 `SelectTrigger`;options 由 `SelectItem` 映射。
6. **Segmented → Tabs**:`<Tabs value onValueChange>` + `TabsList/TabsTrigger`,状态接线保持。
7. **Dropdown + MenuProps → DropdownMenu**:菜单项映射 `DropdownMenuItem`,`danger` 项加 `text-destructive`;`data-testid` 逐项保留。
8. **Tag → Badge**:颜色映射用 tokens 状态色组(`--status-*`/语义色);形态对齐原型(圆角 pill、无边框填充)。
9. **Empty → 自写空态**:形态取原型 `.empty`(图标/标题/说明居中),文案走现有 i18n 键。
10. **antd Typography** → 原生元素 + tokens 文本色(`text-[var(--error)]` 等)。
11. **Button**:替换为 shadcn `Button`(variant 按语义:主操作 `gradient` 或 `default`、危险 `destructive`、次级 `outline`/`ghost`),`block` → `w-full`,`size="large"` → `size="lg"`。

## Review Focus(spec 隐含但任务测试不覆盖的输入面,审查者逐条检查)

1. **DnD 拖拽回归**:三个看板换渲染层后 dnd-kit 的 sensors/keys/放置判定不得变化,拖拽跨列更新状态仍走原 action。→ Task 6/8 用 e2e `03-kanban-drag` + `06-space-kanban` 钉住。
2. **Radix portal 下的 e2e 弹窗寻址**:Dialog/AlertDialog 渲染在 body portal,弹窗内 data-testid 仍可被 e2e 定位,Esc/遮罩关闭不吞提交。→ Task 2 用 e2e `02/05/10` 钉住。
3. **统计带筛选参数组合**:`status`/`overdue`/`dueSoon` 与既有 `project`/`assignee` 参数叠加时聚合不错位、URL 可分享。→ Task 7 service 单测钉住。
4. **preflight 开启的全局视觉回归**(清场步骤):全局 reset 不得破坏存量页面布局。→ Task 11 全路由走查 + 全量 e2e 钉住。
5. **Calendar 时区语义**:react-day-picker 的「今天」高亮与任务落格必须用 Asia/Shanghai 的 today(RSC 传入),`due_date`(date 字符串)不得经 `new Date()` 本地时区转换。→ Task 10 单测钉住。

---

### Task 1: 共享原子件换芯(StatusTag / ProgressBar / ConfirmModal)

**Files:**
- Modify: `apps/web/src/components/ui/StatusTag.tsx`(Tag → Badge)
- Modify: `apps/web/src/components/ui/ProgressBar.tsx`(Progress → shadcn Progress)
- Modify: `apps/web/src/components/ui/ConfirmModal.tsx`(Modal → AlertDialog)
- Test: `apps/web/src/components/ui/AtomsShadcn.test.tsx`(新,SSR 渲染断言,仿 TaskDetailView.test.tsx 的 NextIntlClientProvider 模式)

**Interfaces:**
- Consumes: shadcn `Badge`/`Progress`/`AlertDialog`(components/ui/shadcn,Plan 1 vendored)。
- Produces: 三个组件公开 props **完全不变**(`StatusTagProps { status }`、`ProgressBarProps { value: 0~1 }`、`ConfirmModalProps { open, title, content, confirmText?, danger?, loading?, okButtonProps?, onConfirm, onCancel }`),`okButtonProps` 透传到 AlertDialogAction(含 data-testid);所有消费方零改动。

- [ ] **Step 1: 写失败测试**(三断言:StatusTag 渲染 pill 徽章且 html 不含 `ant-` 类;ProgressBar 渲染 `data-slot="progress"` 且 aria-label 保留;ConfirmModal 渲染取消/确认两按钮且 `danger: true` 时确认按钮含 `destructive` 样式、`okButtonProps.data-testid` 落在确认按钮上)
- [ ] **Step 2: 运行确认失败**:`pnpm vitest run AtomsShadcn` → FAIL(仍含 antd 标记)
- [ ] **Step 3: 换芯实现**:StatusTag → `Badge`(tokens 状态色,`rounded-[var(--radius-pill)]`);ProgressBar → shadcn `Progress`(value 0~100 钳制,`aria-label` 保留,6px 高度对齐原型);ConfirmModal → shadcn `AlertDialog`(受控 open/onOpenChange,Cancel=`AlertDialogCancel` 文案 t("cancel"),Action=确认钮,`danger` 映射 `destructive` variant,`loading` 映射 disabled+spinner)
- [ ] **Step 4: 运行确认通过** → PASS;全量 `pnpm test` 绿(StatusTag/ProgressBar 消费方渲染快照如有断言不受影响)
- [ ] **Step 5: Commit** `refactor(ui): re-core StatusTag, ProgressBar, ConfirmModal on shadcn`

### Task 2: teams 模块(弹窗群 + 表单群)

**Files(antd import 清零目标):**
- 表单: `features/teams/components/CreateTeamForm.tsx`、`RenameTeamForm.tsx`、`InviteMemberForm.tsx`(Form/Input/Button/Alert → RHF 惯例 2)
- 确认按钮群(App+Button → toast 惯例 1,已有 ConfirmModal 的不动): `members/{LeaveTeamButton,RemoveMemberButton,TransferTeamButton,DissolveTeamButton}.tsx`、`joins/CancelJoinRequestButton.tsx`、`invites/InviteRespondButtons.tsx`、`components/RescindInviteButton.tsx`(DissolveTeamButton 另有 Input 确认文案 → Dialog 惯例 3 内嵌 Input)
- 其余: `joins/JoinByCodeForm.tsx`(RHF)、`joins/JoinRequestList.tsx`(App/Button/Tag → toast+Button+Badge)、`joins/JoinCodeSettings.tsx`(App/Button/Switch/Typography → toast+Button+shadcn Switch+惯例 10)、`components/MemberList.tsx`(Tag → Badge)
- 页面: `app/(dashboard)/space/[teamSlug]/settings/page.tsx`(Tag → Badge)

- [ ] **Step 1: 按惯例逐文件迁移**(顺序:表单群 → 按钮群 → 其余;每文件完成即该文件 antd import 清零)
- [ ] **Step 2: 验证**:`pnpm build && pnpm typecheck && pnpm lint`;全量 vitest;e2e `02-team-invite`、`05-dissolve-team`、`10-team-join-by-code`、`11-space-switching`(停 dev server 后跑)
- [ ] **Step 3: 手动走查**:建团/邀请/解散弹窗对齐原型 teams 相关页;解散确认(Input 确认文案)形态正确;toast 出现在右下角
- [ ] **Step 4: Commit** `feat(teams): migrate module to shadcn primitives and sonner`

### Task 3: task-detail 共享详情视图

**Files:**
- Modify: `apps/web/src/components/ui/task-detail/TaskDetailView.tsx`(Button/Dropdown/Form/Input/Modal/Select → 惯例 1/2/5/7/11;内部编辑表单、状态 Dropdown、子任务行、评论输入)
- Modify: `apps/web/src/components/ui/task-detail/TaskDetailView.test.tsx`(如断言含 antd 类名则同步)

**Interfaces:**
- Consumes: Task 1 ConfirmModal(删除确认已用)。
- Produces: `TaskDetailViewProps` 不变;personal/team 两个 DetailClient(Task 4/8)只消费此组件。

- [ ] **Step 1: 迁移**(保留全部 data-testid:`task-detail-*`;权限门渲染逻辑不动)
- [ ] **Step 2: 验证**:build/typecheck/lint + 全量 vitest(含 TaskDetailView.test.tsx)+ e2e `01-personal-task-subtask`
- [ ] **Step 3: Commit** `refactor(task-detail): migrate detail view to shadcn primitives`

### Task 4: personal 模块(个人任务 + 个人项目 + my-tasks)

**Files:**
- `features/personal/tasks/components/`: `NewTaskModal.tsx`(Alert/App/Form/Input/Modal/Select → 惯例 1/2/3/5)、`CommentBox.tsx`(Button/Input)、`SubtaskList.tsx`(Button/Checkbox/Input)、`ProjectTaskTable.tsx`(Button/Select)、`TaskRowActions.tsx`(App/Button/Dropdown/Segmented → 惯例 1/7/6)、`PersonalKanban.tsx`(App/Button → 惯例 1;DnD 逻辑不动)
- `features/personal/tasks/components/TaskDetailClient.tsx`(App → toast)
- `features/personal/projects/components/`: `PersonalProjectFormModal.tsx`(RHF+Dialog)、`NewPersonalProjectButton.tsx`、`PersonalProjectHeaderActions.tsx`(toast+ConfirmModal)
- `features/dashboard/my-tasks/components/NewTaskModal.tsx`(RHF+Dialog+Select)

- [ ] **Step 1: 按惯例逐文件迁移**
- [ ] **Step 2: 验证**:build/typecheck/lint + 全量 vitest + e2e `01`、`09-personal-settings`
- [ ] **Step 3: 手动走查**:个人看板拖拽、新建任务弹窗(原型 personal 相关页对照)、任务详情编辑/评论/子任务、行操作 Dropdown
- [ ] **Step 4: Commit** `feat(personal): migrate module to shadcn primitives and sonner`

### Task 5: users + notifications(设置 + 通知铃)

**Files:**
- `features/users/components/`: `ChangePasswordForm.tsx`(RHF)、`LanguageSetting.tsx`(App/Select → toast+shadcn Select;切换后立即生效语义不动)、`ReminderToggleList.tsx`(App/Switch → toast+shadcn Switch)
- `features/notifications/components/NotificationBell.tsx`(App/Badge/Button/Empty/Popover/theme/Typography → toast+Badge+Button+空态惯例 9+shadcn Popover;`typeGlobalToken` 删除)
- `app/(dashboard)/space/personal/settings/page.tsx`(Alert/Tag → shadcn Alert/Badge)

- [ ] **Step 1: 按惯例逐文件迁移**(NotificationBell 的 Popover 内容对齐原型通知形态;parseBoldSegments 渲染不动)
- [ ] **Step 2: 验证**:build/typecheck/lint + 全量 vitest + e2e `04-cron-reminder`、`09`、`12-en-locale-smoke`
- [ ] **Step 3: 手动走查**:改密/语言切换/提醒开关的 toast 反馈;通知铃 Popover 空态与列表形态
- [ ] **Step 4: Commit** `feat(users): migrate settings and notification bell to shadcn`

### Task 6: dashboard + kanban 换皮(DnD 不动)

**Files:**
- `features/dashboard/personal-dashboard/components/TodayTaskList.tsx`(App/Checkbox → toast+shadcn Checkbox)
- `features/kanban/components/SpaceKanban.tsx`(App/Button/Tag → toast+Button+Badge;**dnd-kit 逻辑逐行不动**)
- `features/kanban/components/SpaceKanbanFilterBar.tsx`(Segmented/Select → 惯例 5/6;URL 驱动接线不动)
- `features/kanban/components/PersonalKanbanNewTaskButton.tsx`(Button)
- `app/(dashboard)/space/[teamSlug]/kanban/page.tsx`(Button)

- [ ] **Step 1: 按惯例逐文件迁移**
- [ ] **Step 2: 验证**:build/typecheck/lint + 全量 vitest + e2e `03-kanban-drag`、`06-space-kanban`、`11`
- [ ] **Step 3: Commit** `feat(kanban): migrate boards and filter bar to shadcn`

### Task 7: 看板统计带进 app(Phase 0 口径,service 只读扩展)

**Files:**
- Modify: `apps/web/src/features/kanban/service.ts`(筛选只读扩展 + 统计/项目进度查询)
- Modify: `apps/web/src/features/kanban/service.test.ts`(新用例)
- Create: `apps/web/src/features/kanban/components/KanbanStatStrip.tsx` + `KanbanStatStrip.test.tsx`
- Modify: `app/(dashboard)/space/[teamSlug]/kanban/page.tsx` 与 `app/(dashboard)/space/personal/kanban/page.tsx`(searchParams 解析 + 挂载)
- Modify: `apps/web/src/i18n/messages/{zh,en}.json`(统计带文案,含口径说明,按原型逐字)

**Interfaces(Produces,Plan 后续只读):**
```ts
// service.ts 只读扩展(不改既有字段与签名)
interface PersonalSpaceBoardFilter { projectId?: string; status?: TaskStatus; overdueOnly?: boolean; dueSoonOnly?: boolean }
interface TeamSpaceBoardFilter   { projectId?: string; unassignedOnly?: boolean; status?: TaskStatus; overdueOnly?: boolean; dueSoonOnly?: boolean }

export interface KanbanStats {
  todo: number;        // 未开始(排除已完成)
  inProgress: number;  // 进行中(排除已完成)
  doneRecent: number;  // 近 7 天完成(与 done 列同口径 doneWindowStart)
  overdue: number;     // due_date < today 且未完成
  dueSoon: number;     // today <= due_date <= today+3 且未完成
}
export async function getPersonalKanbanStats(userId: string, today: string, filter?): Promise<KanbanStats>
export async function getTeamKanbanStats(teamId: string, today: string, filter?): Promise<KanbanStats>
export interface ProjectProgressEntry { projectId: string; progress: number }
export async function getTeamKanbanProjectProgress(teamId: string, today: string): Promise<ProjectProgressEntry[]>
// progress 与 Dashboard 健康度卡同源:taskProgress 公式 + aggregateProjectProgress(@open-doing/types)
```
- 页面 searchParams:`status=todo|in_progress|done`、`overdue=1`、`dueSoon=1`,与既有 `project`/`assignee` 叠加;scope 谓词按新字段收窄(卡片查询与统计共用同一组谓词,不分叉)。
- `KanbanStatStrip` props:`{ stats: KanbanStats; active: { status?, overdue?, dueSoon? }; basePath: string; preserveParams: Record<string,string> }`;chips `data-filter` 对齐原型(`status:todo`/`status:in_progress`/`status:done`/`overdue`/`due-soon`),点击 `router.push` 重写 query,**aria-pressed** 标记激活;项目 Select 选项追加 `· NN%`。

- [ ] **Step 1: 写失败测试**(service.test.ts 新用例:①todo/inProgress 计数排除已完成;②overdue 排除已完成与未来到期;③dueSoon 仅含 3 天窗口;④status/overdueOnly/dueSoonOnly 筛选收窄卡片查询与统计同谓词;⑤项目进度公式与 Dashboard 一致)
- [ ] **Step 2: 运行确认失败** → FAIL(函数不存在)
- [ ] **Step 3: 实现 service 扩展**(谓词复用 scope;dueSoon 用 SQL between 字符串比较,date 列 ISO 安全;不取本地时区)
- [ ] **Step 4: 运行确认通过** → PASS
- [ ] **Step 5: KanbanStatStrip 组件**(RSC 传入 stats/today/active,客户端 chips;两个看板页挂载;文案进双目录)
- [ ] **Step 6: e2e `06-space-kanban` 扩展断言**(新增 describe:点击已逾期 chip → URL 带 `?overdue=1` → 看板只剩逾期卡;aria-pressed 激活态)——既有断言不动
- [ ] **Step 7: 全量验证** + 手动走查对照 `docs/prototypes/space-kanban-team.html`/`-personal.html` 统计带形态与文案
- [ ] **Step 8: Commit** `feat(kanban): add clickable stat strip with url-driven filters`

### Task 8: tasks/projects 团队侧(最大模块)

**Files:**
- `features/tasks/components/`: `NewTeamTaskModal.tsx`(RHF+Dialog+Select)、`TeamKanban.tsx`(App/Button/Select → toast;**DnD 不动**)、`TeamProjectHeader.tsx`(Button/Segmented)、`TeamProjectTaskTable.tsx`(Button/Pagination/Select → shadcn Pagination)、`TeamTaskDetailClient.tsx`(App → toast)、`TeamTaskRowActions.tsx`(App/Button/Dropdown)
- `features/projects/components/`: `TeamProjectForm.tsx`(RHF)、`TeamProjectHeaderActions.tsx`(App/Button/Modal → toast+Dialog/ConfirmModal)

- [ ] **Step 1: 按惯例逐文件迁移**
- [ ] **Step 2: 验证**:build/typecheck/lint + 全量 vitest + e2e `03`、`06`
- [ ] **Step 3: 手动走查**:团队看板拖拽、新建团队任务弹窗、项目表格分页、行操作、项目改名/删除确认
- [ ] **Step 4: Commit** `feat(tasks): migrate team tasks and projects to shadcn`

### Task 9: AppShell 布局件 + invites 页

**Files:**
- `components/layout/Topbar.tsx`(Dropdown/Input → 惯例 5/7;搜索框形态对齐原型 topbar)
- `components/layout/SpaceSwitcher.tsx`(Dropdown → DropdownMenu)
- `components/layout/MobileNav.tsx`(Button/Drawer → shadcn Sheet)
- `app/(dashboard)/invites/page.tsx`(Tag → Badge)

- [ ] **Step 1: 按惯例逐文件迁移**(冻结契约解冻仅限 UI 层:路由结构与 Server Action 调用关系不变)
- [ ] **Step 2: 验证**:build/typecheck/lint + 全量 vitest + e2e `11-space-switching`、`12-en-locale-smoke`
- [ ] **Step 3: 手动走查**:桌面/移动两态 Topbar、空间切换、移动端 Sheet 导航
- [ ] **Step 4: Commit** `feat(layout): migrate app shell chrome to shadcn`

### Task 10: calendar(react-day-picker)

**Files:**
- Modify: `apps/web/src/features/calendar/components/SpaceCalendar.tsx`(antd Calendar → react-day-picker MonthGrid + 自定义 day cell)
- Modify: `apps/web/package.json`(新增 `react-day-picker`、`date-fns`)
- Modify: `apps/web/src/i18n/messages/{zh,en}.json`(如缺日历文案)
- Test: `features/calendar/components/calendar-days.test.ts`(新)

**Interfaces:**
- Consumes: RSC 传入 `today`(Asia/Shanghai,`lib/today.ts`)与任务数据(既有 service 不动)。
- Produces: 月网格按 `due_date`(date 字符串)落格,**不经 `new Date()` 本地时区转换**;date-fns locale 按 AppLocale 映射(`{ zh: zhCN, en: enUS }`);点日/点任务的既有交互语义保持(e2e 07 是契约)。

- [ ] **Step 1: 写失败测试**(`calendar-days.test.ts`:给定 today="2026-11-02" 与任务 due_date 集合,落格映射正确;11 月网格首尾补齐;今天高亮键 = "2026-11-02",不受运行时时区影响——以 `TZ=America/New_York` 运行断言不变)
- [ ] **Step 2: 运行确认失败** → FAIL(模块不存在)
- [ ] **Step 3: 实现**落格纯函数 + 组件换装(月份文案/星期 locale 化)
- [ ] **Step 4: 运行确认通过** → PASS;`TZ=America/New_York pnpm vitest run calendar-days` 亦 PASS
- [ ] **Step 5: 验证**:build/typecheck/lint + 全量 vitest + e2e `07-space-calendar`
- [ ] **Step 6: Commit** `feat(calendar): replace antd calendar with react-day-picker`

### Task 11: 清场(移除 antd + preflight 开启 + 全局审计)

**Files:**
- Modify: `apps/web/src/app/providers.tsx`(重写:移除 AntdRegistry/ConfigProvider/AntApp 与 antd/dayjs locale 切换;保留 `<Toaster />` 与 html lang 机制;dayjs 依赖保留——SpaceCalendar 等格式化仍用)
- Delete: `apps/web/src/app/theme.ts`
- Modify: `apps/web/package.json`(移除 `antd`、`@ant-design/nextjs-registry`)
- Modify: `apps/web/src/app/globals.css`(开启 preflight:`@import "tailwindcss/preflight.css" layer(base);`)

- [ ] **Step 1: Providers 重写 + theme.ts 删除 + 依赖移除 + `pnpm install`**
- [ ] **Step 2: 归零验证**:`grep -rn 'from "antd"' apps/web/src` → 0 行;`grep -rn '@ant-design' apps/web/src` → 0 行
- [ ] **Step 3: 全量测试**:`pnpm build && pnpm typecheck && pnpm lint`;全量 vitest;**全量 e2e**(12 条 flow 全跑,停 dev server)
- [ ] **Step 4: 全局视觉审计**(preflight 已开):Playwright 走查全部路由(login/register/dashboard 两态/kanban 两态/tasks/projects/calendar/analysis/settings 两态/invites/通知/详情/弹窗群),与 `docs/prototypes/` 对应页对照;偏差就地修复(样式层,不动结构)后重跑本步
- [ ] **Step 5: Commit** `refactor(ui): remove antd and enable tailwind preflight`

## Self-Review 记录

- Spec 覆盖:Phase 2 清单 8 步全部有对应任务(auth 在 Plan 1);Phase 1 遗留的 StatusTag/ProgressBar 换芯归入 Task 1(spec 将其列在 Phase 1,Plan 1 实际只 vendored 原子件,此处补齐,接口不变)。
- 步骤可执行性:机械转换由「转换惯例」承载精确模式;新逻辑(service 扩展、统计带、calendar 落格)有具名测试与断言方向。
- 类型一致性:KanbanStats/ProjectProgressEntry 仅 Task 7 产出、无下游任务消费;ConfirmModal/StatusTag/ProgressBar props 不变契约已声明。
- e2e 契约:既有 12 条 flow 的断言与选择器不改;仅 Task 7 新增 describe。
