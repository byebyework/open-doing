# 轨道 N：通知与 cron 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 落地 `docs/V1_TASKS.md` §7 轨道 N 的 N-1/N-2/N-3：通知服务定稿与接线清单、通知中心 UI（顶栏角标 + popover）、到期扫描 cron。

**Architecture:** `createNotification` 冻结契约不动，新增 `queries.ts`（未读数/分页列表/标记已读）与 `due-scan.ts`（批量幂等扫描）；写操作走 Server Actions（`actions.ts`），读走轮询 Route Handler `/api/notifications`（§2 API 例外）；cron 为 `POST /api/cron/due-scan` + Bearer 密钥。通知 → 任务详情的跳转 href 在查询层富化（批量取关联对象后拼装，不做多表 JOIN 拼图）。

**Tech Stack:** Next.js 16 App Router + React 19 + antd v6 + Drizzle/PostgreSQL + Vitest（DB 用例走 `TEST_DATABASE_URL`）。

**Spec:** `docs/V1_TASKS.md` §7 轨道 N（N-1/N-2/N-3/INT-2）；文案对照 `docs/prototypes/my-tasks.html` 通知 popover。

## Global Constraints

- 不改 `createNotification` 签名与文件路径（`features/notifications/service.ts`，F-3 冻结）；不动 J 的 `notifySafely`（INT-2 议题②，留给集成）。
- 除一处例外（T-3 明文"标记已读逻辑在 N 线补"：`features/teams/invites/service.ts` 的 `respondToInvite` 内插一次 `markTeamInviteNotificationsRead` 调用），不改 T/J/G 任何文件。
- 写操作只走 Server Actions，返回 `ActionResult<T>`；每个 action 独立鉴权（不靠隐藏按钮）。
- 日期口径统一 Asia/Shanghai；截止日当天不算逾期，次日起算；临期 = 今天/明天；已完成不计。复用 `@open-doing/types` 的 `isOverdue`/`isDueSoon`/`addDays`（today 由调用方注入，纯函数不取系统时间）。
- 通知幂等：`(user_id, task_id, type)` 部分唯一索引（`schema.ts:196`）兜底；cron 重复扫描不产生重复通知；任务转 done 后不再产生新通知（历史保留）。
- 个人空间只产生到期类提醒；无指派/评论/改动类通知（个人服务本就不调用 `createNotification`，接线清单记录口径，INT-2 核验）。
- 中文文案、中文注释；commit message 英语；样式只用设计令牌；375px 无横向溢出。
- 写代码前读 `apps/web/node_modules/next/dist/docs/` 中 Route Handlers 与 caching 相关指南（Next 16 破坏性变更）。
- 收尾：`pnpm --filter @open-doing/web test` / `typecheck` / `lint` / `build` 全绿。

## Review Focus

1. **cron 当天重复执行**（生产最常见）：同任务同类型必须只留一条 → Task 5 幂等测试（连跑两次断言 1 条）。
2. **截止日期被改到过去/未来后的再扫描**：`task_due_soon` 与 `task_overdue` 是不同 type，允许各一条；同 type 绝不重复 → Task 5 测试钉住。
3. **无指派任务（成员离开置空 assignee）**：cron 必须跳过、不崩溃、不产生无主通知 → Task 5 测试。
4. **跨用户隔离与未登录**：`/api/notifications` 未登录 401；列表只含本人通知；标记他人通知已读返回 false → Task 3 测试。
5. **时区口径**：cron 在 UTC 下午跑（上海已是次日）时 today 取 Asia/Shanghai → Task 5 对 `shanghaiToday` 用固定时刻断言。

---

### Task 1: N-1 通知查询与已读服务（`queries.ts`）

**Files:**
- Create: `apps/web/src/features/notifications/queries.ts`
- Create: `apps/web/src/features/notifications/queries.test.ts`
- 不动: `apps/web/src/features/notifications/service.ts`（`createNotification` 契约保持原样）

**Interfaces:**
- Consumes: `DbClient`（`@/server/db/client`）、`notifications`/`tasks`/`projects`/`teams`/`users`（`@/server/db/schema`）、`NotificationType`（`@open-doing/types`）。
- Produces（Task 2/3/4、接线点消费）:
  ```ts
  export interface NotificationListItem {
    id: string;
    type: NotificationType;
    read: boolean;
    createdAt: string;            // ISO 字符串
    actorName: string | null;     // 触发者用户名；系统产生（cron）为 null
    teamName: string | null;
    taskTitle: string | null;
    href: string | null;          // buildNotificationHref 结果，无关联对象时 null
  }
  getUnreadNotificationCount(userId: string, client?: DbClient): Promise<number>
  listNotifications(input: { userId: string; limit?: number /* 默认 20 */ }, client?: DbClient): Promise<NotificationListItem[]>
  markNotificationRead(input: { userId: string; notificationId: string }, client?: DbClient): Promise<boolean>   // false = 不存在或非本人
  markAllNotificationsRead(userId: string, client?: DbClient): Promise<number>                                    // 返回置已读条数
  markTeamInviteNotificationsRead(input: { userId: string; teamId: string }, client?: DbClient): Promise<void>
  export function buildNotificationHref(item: { type: NotificationType; taskId?: string | null; spaceType?: string | null; teamSlug?: string | null; projectSlug?: string | null }): string | null
  ```
  href 规则：`team_invite` → `/invites`；任务类通知且 `spaceType==='team'` → `/teams/{teamSlug}/projects/{projectSlug}/tasks/{taskId}`；`spaceType==='personal'` → `/my/tasks/{taskId}`；其余（无 taskId / 参数缺失）→ `null`。

- [ ] **Step 1: 写失败测试**（`queries.test.ts`，仿 `features/teams/invites/service.test.ts` 的 `setupTestDb` + `describe.skipIf(!hasTestDatabase)` 结构；造数 helper：两个用户 + 一团队 + 一个人任务 + 一团队项目/团队任务，`createNotification` 直插若干条）
  - `getUnreadNotificationCount` 只统计本人 `read=false` 条数。
  - `listNotifications` 按 `createdAt` 降序、`limit` 生效；`team_invite` 条目 `href='/invites'`、含 `teamName` 与 `actorName`；团队任务通知 `href` 含团队/项目 slug 与任务 id、含 `taskTitle`；个人任务通知 href 为 `/my/tasks/{id}`。
  - `markNotificationRead`：本人通知置已读返回 true；他人通知返回 false 且不落库；不存在 id 返回 false。
  - `markAllNotificationsRead` 只动本人；返回条数；二次调用返回 0。
  - `buildNotificationHref` 纯函数表驱动用例：六种 type × 有/无 slug × personal/team。
- [ ] **Step 2: 跑测试确认失败** — `pnpm --filter @open-doing/web exec vitest run src/features/notifications/queries.test.ts`（项目名 `web`），预期 FAIL（模块不存在）。
- [ ] **Step 3: 实现 `queries.ts`**。`listNotifications` 两段式：先按 userId+降序取 N 条通知行，再用 `inArray` 批量取 tasks（得 title/spaceType/projectId）、projects（slug）、teams（name/slug）、actor 用户名，JS 内组装 `NotificationListItem`；`markTeamInviteNotificationsRead` = `update notifications set read=true where userId and teamId and type='team_invite' and read=false`。
- [ ] **Step 4: 跑测试通过**（同 Step 2 命令）。
- [ ] **Step 5: Commit** — `feat(notifications): add read-model queries and mark-read service`

### Task 2: N-1 接线清单 + 邀请响应已读接线

**Files:**
- Create: `docs/notifications-wiring.md`
- Modify: `apps/web/src/features/teams/invites/service.ts`（`respondToInvite` 事务内、写 membership 之后插一行调用——T-3 明文授权的唯一跨文件接线）
- Modify: `apps/web/src/features/teams/invites/service.test.ts`（补 1 例）

**Interfaces:**
- Consumes: Task 1 的 `markTeamInviteNotificationsRead({ userId, teamId }, tx)`。
- Produces: `docs/notifications-wiring.md`——INT-2 的核验清单。

- [ ] **Step 1: 写失败测试**（追加到 invites service 测试）：owner 邀请 outsider → outsider `respondToInvite` 接受 → 断言 outsider 名下 `team_invite` 通知 `read=true`。
- [ ] **Step 2: 跑测试确认失败**（预期 FAIL：通知仍为未读）。
- [ ] **Step 3: 接线**：`respondToInvite` 的 `run(tx)` 内、membership 写入后调用 `await markTeamInviteNotificationsRead({ userId: row.inviteeId, teamId: row.teamId }, tx)`；接受与拒绝分支都生效（放在分支汇合处）。
- [ ] **Step 4: 跑测试通过**。
- [ ] **Step 5: 写 `docs/notifications-wiring.md`**，逐行列出（INT-2 按此核验）：
  | 接线点 | 条件 | 通知谁 | 关联对象 |
  |---|---|---|---|
  | `features/teams/invites/service.ts` `createInvite` | 邀请发出 | invitee | teamId, actorId=invitedBy；taskId=null |
  | 同上 `respondToInvite` | 邀请被接受/拒绝 | —（把 invitee 的 `team_invite` 通知置已读，不通知自己/邀请人另由既有 team_invite 通知覆盖） | teamId |
  | `features/tasks/service.ts` 创建/改派 | assignee≠actor | assignee，`task_assigned` | teamId/projectId/taskId/actorId |
  | 同上 owner/admin 编辑他人任务 | — | assignee（≠actor），`task_changed_by_admin` | 同上 |
  | 同上 评论 | author≠task 责任人时的接收集合按 J 实现 | 非 author 的相关人员，`task_commented` | 同上 |
  | `features/notifications/due-scan.ts`（Task 5） | 临期/逾期 | assignee（个人+团队全空间） | taskId，actorId=null |
  - 记录口径：邀请接受不通知自己；评论不通知本人；个人空间只产生到期类提醒（个人服务无 `createNotification` 调用点）。
- [ ] **Step 6: Commit** — `feat(notifications): wiring doc + mark invite notifications read on respond`

### Task 3: N-2 读接口 Route Handler + Server Actions

**Files:**
- Modify: `apps/web/src/app/api/notifications/route.ts`（替换 401 桩）
- Create: `apps/web/src/features/notifications/actions.ts`
- Create: `apps/web/src/features/notifications/actions.test.ts`（`buildNotificationHref` 已在 Task 1 测过；本任务测 action 鉴权与返回结构）

**Interfaces:**
- Consumes: Task 1 全部查询函数；`getSessionUserId`（`@/features/auth/session`）；`ActionResult<T>`（`@/features/auth/actions`）。
- Produces:
  ```ts
  // route.ts  GET /api/notifications
  // 200: { ok: true, unreadCount: number, items: NotificationListItem[] } （items 按 createdAt 降序，默认 20 条）
  // 401: { ok: false }
  export async function markNotificationReadAction(notificationId: string): Promise<ActionResult<{ unreadCount: number }>>
  export async function markAllNotificationsReadAction(): Promise<ActionResult<{ unreadCount: number }>>
  ```
- [ ] **Step 1: 读 Next 16 文档** — `apps/web/node_modules/next/dist/docs/` 中 route handlers / caching 指南，确认动态读取（cookies）即免缓存。
- [ ] **Step 2: 写失败测试**：action 未登录返回 `{ ok: false, errors: { form: "请先登录" } }`；登录后调用 `markAllNotificationsReadAction` 置已读并返回 `unreadCount: 0`（用 `setupTestDb` + 直插通知；登录态通过 `cookies()` 不可直调时，按仓库既有 action 测试模式处理——参照 `features/teams/invites/actions.test.ts` 的做法）。
- [ ] **Step 3: 跑测试确认失败**。
- [ ] **Step 4: 实现** `actions.ts`（仿 `invites/actions.ts`：`getCurrentUser` 鉴权 → 调 queries → 返回最新 `unreadCount`）与 `route.ts`（`getSessionUserId()` 判空 401；否则返回 unreadCount + items；`export const dynamic = "force-dynamic"` 或依赖 cookies 自动动态，以文档为准）。
- [ ] **Step 5: 跑测试通过**；`pnpm --filter @open-doing/web typecheck`。
- [ ] **Step 6: Commit** — `feat(notifications): polling read API and mark-read server actions`

### Task 4: N-2 通知中心 UI（NotificationBell 替换）

**Files:**
- Modify: `apps/web/src/features/notifications/components/NotificationBell.tsx`（原路径替换，Topbar 不动）
- Create: `apps/web/src/features/notifications/components/notification-format.ts`（纯函数）
- Create: `apps/web/src/features/notifications/components/notification-format.test.ts`

**Interfaces:**
- Consumes: Task 3 的 GET route + 两个 action；antd `Badge`/`Popover`/`Empty`；dayjs（`zh-cn` locale + `relativeTime` 插件，providers 已配中文）。
- Produces:
  ```ts
  export interface NotificationBody { parts: { text: string; bold: boolean }[] }
  export function formatNotificationBody(item: NotificationListItem): NotificationBody
  // 文案对照原型 my-tasks.html：
  // team_invite: [actor(粗)] 邀请你加入团队「{teamName}」
  // task_assigned: [actor(粗)] 把「{taskTitle}」指派给你
  // task_due_soon: 你负责的「{taskTitle}」今日/明日到期
  // task_overdue: 你负责的「{taskTitle}」已逾期（"已逾期"粗体）
  // task_commented: [actor(粗)] 评论了「{taskTitle}」
  // task_changed_by_admin: [actor(粗)] 更新了你负责的「{taskTitle}」
  ```
- [ ] **Step 1: 写失败测试**：六种 type 的 `formatNotificationBody` 输出断言（actor 缺失时 cron 类通知以"系统"开头或直接陈述句——定稿：`actorName=null` 时文案去掉主体，如「你负责的「X」已逾期」）；相对时间用 dayjs `fromNow`，不测（依赖当前时钟）。
- [ ] **Step 2: 跑测试确认失败**。
- [ ] **Step 3: 实现** `notification-format.ts` 与 `NotificationBell.tsx`：客户端组件（`"use client"`），30 秒轮询 `GET /api/notifications`（`fetch` + `useEffect`，卸载清理；401 时静默停轮询）；铃铛 `Badge` 显示 unreadCount；`Popover` 内列表（未读高亮、图标按 type 着色用令牌变量），单条点击 → 调 `markNotificationReadAction` 后 `router.push(href)`（href 为 null 只标记已读）；头部「全部已读」按钮调 `markAllNotificationsReadAction` 并本地刷新；空态用 antd `Empty` 文案「暂无通知」；`visibilitychange` 时立即刷新一次。不做 popover 外的独立通知页（原型 `查看全部通知` 链接在 v1 无对应页面，省略——偏差记录在本文件与本组件注释）。
- [ ] **Step 4: 跑测试通过**；`pnpm --filter @open-doing/web lint && typecheck`；`pnpm dev -p 3004` 手工冒烟：插入一条通知 → 角标出现 → 点击跳任务详情 → 已读。
- [ ] **Step 5: Commit** — `feat(notifications): notification bell popover with unread badge polling`

### Task 5: N-3 到期扫描核心（`due-scan.ts`）

**Files:**
- Create: `apps/web/src/features/notifications/due-scan.ts`
- Create: `apps/web/src/features/notifications/due-scan.test.ts`

**Interfaces:**
- Consumes: `addDays`/`isOverdue`/`isDueSoon`（`@open-doing/types`）；`notifications`/`tasks` schema；部分唯一索引 `(user_id, task_id, type)`。
- Produces:
  ```ts
  export function shanghaiToday(now?: Date): string            // Intl 'en-CA' + timeZone 'Asia/Shanghai' → YYYY-MM-DD
  export interface DueScanResult { dueSoon: number; overdue: number }
  export async function runDueScan(client?: DbClient, today?: string): Promise<DueScanResult>
  ```
  扫描规则：`status != 'done' AND due_date IS NOT NULL AND assignee_id IS NOT NULL AND (due_date < today OR due_date IN (today, addDays(today,1)))`；`due_date < today` → `task_overdue`，否则 `task_due_soon`；接收人 = assignee，`actorId=null`，带 teamId/projectId/taskId；单条批量 `insert ... onConflictDoNothing`（幂等交给部分唯一索引——N-1 定稿后的"等价检查"实现，替代 J 的 notifySafely 语义）。
- [ ] **Step 1: 写失败测试**（DB 用例，today 显式注入如 `'2026-10-24'`）：
  - 昨天到期未完成任务 → 扫描产生 1 条 `task_overdue` 给 assignee；**连跑两次仍 1 条**（幂等，Review Focus 1）。
  - 今天/明天到期 → 各 1 条 `task_due_soon`；后天到期 → 0 条。
  - 已完成任务（昨天到期）→ 0 条；assignee=null 的未完成任务 → 0 条且不报错（Review Focus 3）。
  - 扫描后把 due_date 改到过去再扫 → 新增 1 条 `task_overdue`（与已有 `task_due_soon` 并存，Review Focus 2）。
  - 个人任务（`space_type='personal'`）同样被扫描并通知 assignee。
  - `shanghaiToday(new Date('2026-10-24T17:00:00Z'))` === `'2026-10-25'`（Review Focus 5）。
- [ ] **Step 2: 跑测试确认失败**。
- [ ] **Step 3: 实现 `due-scan.ts`**（规则见 Produces；查询用 `lt/eq/inArray + or`；`createdAt` 用默认 now）。
- [ ] **Step 4: 跑测试通过**。
- [ ] **Step 5: Commit** — `feat(notifications): idempotent due-date scan service`

### Task 6: N-3 cron Route Handler + 本地触发说明

**Files:**
- Create: `apps/web/src/app/api/cron/due-scan/route.ts`
- Modify: `README.md`（cron 一节）、`.env.example`（`CRON_SECRET` 下补触发命令注释）

**Interfaces:**
- Consumes: Task 5 的 `runDueScan`/`shanghaiToday`；`process.env.CRON_SECRET`。
- Produces: `POST /api/cron/due-scan`——鉴权通过返回 `200 { ok: true, dueSoon, overdue }`；密钥缺失/不匹配返回 `401 { ok: false }`（且不执行扫描）。
- [ ] **Step 1: 实现鉴权纯函数 + route**：`isAuthorizedCronRequest(req: NextRequest)` 接受 `Authorization: Bearer ${CRON_SECRET}` 或 `x-cron-key: ${CRON_SECRET}`；`CRON_SECRET` 未配置时一律 401；仅允许 POST。读 Route Handler 文档后落笔（Next 16）。
- [ ] **Step 2: 手工验证**：`pnpm dev -p 3004` 后——无密钥 `curl -X POST :3004/api/cron/due-scan` → 401；`curl -X POST -H "Authorization: Bearer dev-only-change-me" ...` → 200 且开发库产生对应通知；**再跑一次数字不变**（幂等，对应 INT-2「手跑两次」）。
- [ ] **Step 3: 文档**：README 增加小节「到期提醒 cron」：本地触发命令 `curl -X POST -H "Authorization: Bearer $CRON_SECRET" http://localhost:3000/api/cron/due-scan`，说明 Asia/Shanghai 口径与幂等语义；`.env.example` 在 `CRON_SECRET` 行下加同款注释。
- [ ] **Step 4: Commit** — `feat(notifications): due-scan cron endpoint with secret auth`

### Task 7: 收尾全量检查 + 任务板回写

**Files:**
- Modify: `docs/V1_TASKS.md`（勾选 N-1/N-2/N-3 验收项；轨道表 N 行状态 🟡→✅；INT-2 议题 ② 标注"由本轨道幂等索引+onConflictDoNothing 取代，notifySafely 移除留给集成裁决"）

- [ ] **Step 1:** `pnpm -r typecheck && pnpm -r lint && pnpm -r test && pnpm --filter @open-doing/web build` 全绿（build 需显式 `DATABASE_URL`，INT-2 议题⑤）。
- [ ] **Step 2:** 对照 V1_TASKS N-1/N-2/N-3 验收项逐条勾选；`docs/notifications-wiring.md` 与板上 INT-2 核验项一致。
- [ ] **Step 3: Commit** — `docs(tasks): mark track N complete with wiring checklist`
