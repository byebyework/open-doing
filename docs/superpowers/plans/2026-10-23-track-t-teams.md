# M1 轨道 T（团队 / UID 邀请 / 角色）实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**执行方式：** 用户已选定"本会话直接实现"（Native）——按 superpowers:executing-plans 逐任务 TDD 实现，收尾做一次全分支代码评审。

**目标：** 完成 `docs/V1_TASKS.md` §6 轨道 T（T-1…T-5）：团队创建与成员关系、角色权限判定层、按 UID 邀请/接受/拒绝/撤销、团队改名与设置页骨架、待处理邀请页，使 M1 出口检查中"创建团队并完成一次 UID 邀请接受全流程"可用。

**架构：** 服务层承载全部鉴权（`actorId` 入参 + `assertCan`，可脱离请求上下文直测）；Server Actions 是薄封装（session → actorId → service → `ActionResult<T>`）；多写操作用 `db.transaction` 包裹并传 tx 给 `createNotification`。UI 为 RSC 页面 + client 交互件（复用 LoginForm 的表单错误模式）。

**技术栈：** Next.js 16 App Router + React 19 + TS strict + antd v6 + Drizzle/Postgres + Vitest（既有依赖，零新增）。

**规格：** `docs/V1_TASKS.md` §6 轨道 T（权威）；`docs/2026-10-21-open-doing-v1-design.md` §4/§5/§6/§10；原型 `docs/prototypes/{team-settings,invites,team-overview}.html`（文案与布局）。

## Context

- 本 worktree（分支 `asher/group`）即 T 轨道 track worktree（V1_TASKS §4.1），直接在此实现；dev 端口 3002、独立库 `open_doing_group`、`.env.local` 不入库。
- M0 冻结点已具备：全量 schema（`teams` slug 全局唯一、`team_memberships` UNIQUE(team_id,user_id)、`team_invites` 部分唯一索引 `(team_id,invitee_id) WHERE status='pending'`、`notifications`）、jose 会话（`getCurrentUser`/`requireUser`）、`ActionResult<T>`、`src/server/db/testing.ts`（`setupTestDb`/`closeTestDb` + `TEST_DATABASE_URL`，无库自动 skip）、6 个共享 UI 组件、`TeamsNav.tsx` 导航桩、`src/lib/uid.ts`。
- 已核实无需新建：`src/features/users/service.ts` 的 `findByUid` 已存在（T-2 文件清单里的这一项是"确认存在"而非新写）；`packages/types` 已导出 §3 契约的 `Team`/`TeamMembership`/`TeamInvite`（ISO 字符串时间）；路由占位 `teams/new/`、`teams/[teamSlug]/projects/...` 已播种。
- T 轨道**不做**（他轨所有）：移除成员/退出/转让/解散（G-1/G-2/G-3）、团队概览页（D）、团队项目与任务（J）、通知已读（N）、SpaceSwitcher 数据接线（INT-1 议题）。

## Global Constraints

- 技术栈固定：Next.js 16 App Router + React 19 + TS strict + antd v6（zh_CN）+ Tailwind 4（无 preflight）+ PostgreSQL + Drizzle。
- 写操作只走 Server Actions，返回 `ActionResult<T>`（定义见 `src/features/auth/actions.ts:19-21`）；每个 action 独立鉴权；服务层同样断言权限（不只是隐藏按钮）。
- 页面 RSC 取数；antd 交互件下沉 `"use client"`，序列化数据经 props 传入。
- 邀请无有效期；同一人对同一团队只允许一条 pending 邀请（DB 部分唯一索引兜底 + 友好错误）。
- 邀请通知四类事件（发出/接受/拒绝/撤销）都调 `createNotification`，类型统一 `team_invite`（§3 类型系统唯一的邀请类通知）。
- **不得修改**：`src/app/(dashboard)/layout.tsx`、`src/components/layout/**`（含 SpaceSwitcher）、`src/server/db/schema.ts` 与迁移、`packages/types`。
- 导航接线只改桩文件 `src/features/teams/components/TeamsNav.tsx`。
- M0 后不得自行加依赖（纯中文团队名不做拼音，slug 回退方案见 T-1）。
- 中文文案、中文注释密度与现有代码一致；commit message 一律英语（Co-Authored-By: Claude Code 落款）。
- 每任务收尾：`pnpm test`、`pnpm --filter @open-doing/web typecheck && lint && build` 全绿。

## Review Focus（规格隐含但测试未直接覆盖、最易咬人的五类输入）

1. **纯中文团队名** → slug 无法从名字生成：期望回退为 `team`/`team-2`… 而非空串或报错。（T-1 `slug.test.ts` 钉住）
2. **响应已失效的邀请**（已被撤销/团队已解散/已响应）→ 期望友好"邀请不存在或已失效"提示而非 500/404。（T-3 `invites/service.test.ts` 钉住）
3. **member 直调被禁 action**（发起/撤销邀请、改名）→ 期望返回 `ok:false` 权限错误，而非仅 UI 隐藏。（各 `actions.test.ts` + service 测试钉住）
4. **非成员/不存在团队访问设置页** → 期望 `notFound()`（不泄露存在性）。（T-2 设置页实现内断言）
5. **邀请自己 / 邀请已是成员 / 重复 pending 邀请** → 期望逐类友好字段错误；并发插入被 23505 兜底。（T-2 `invites/service.test.ts` 钉住）

## 规格冲突裁决（已定，执行时不再讨论）

1. **SpaceSwitcher 静态**：原型把动态团队列表放进切换器，但 `src/components/layout/**` 冻结——M1 团队列表只在 `TeamsNav` 渲染；切换器接线留 INT-1 议题（在任务板备注）。
2. **slug 作用域**：schema 已定全局唯一单列，照此实现，不做迁移。
3. **设置页可见性**：页面全员可进（member 仅见只读成员表），owner/admin 区块按角色显隐；action 端再校验（对齐 T-5"按角色显隐区块但 action 同样鉴权"）。
4. **invites.html 的"团队 12 人 · 3 个项目"**：项目数属 J 域，T 只显示成员数，项目数留 INT/J。
5. **"待处理邀请"侧栏入口**：原型在第三个"账号"分组；`Sidebar` 冻结只有两段——由 `TeamsNav` 末尾追加"账号"分组（顺序：我的任务 → 我的团队 → 账号，恰与原型一致）。
6. **团队导航链接目标**：`/teams/[teamSlug]` 概览页是 D 所有且 M1 不存在——M1 团队项链接到 `/teams/${slug}/settings`（T-2 后真实存在）；INT-1/D-1 再改指概览。
7. **全局 403 页**：无归属任务，本轨道只交付单一可映射 403 的 `TeamPermissionError`；403 页留给 INT/X（任务板备注，不实现）。
8. **设置页危险区**（离开/解散/移除/转让）：G 所有，T 完全不渲染（不留禁用按钮）。

## 任务分解（实施顺序 T-1 → T-4 → T-2 → T-5 → T-3）

> 路径均相对 `apps/web/src/`。每步 = 写失败测试 → 跑红 → 实现 → 跑绿 → commit。测试模板照抄 `features/auth/service.test.ts`（`describe.skipIf(!TEST_DATABASE_URL)`、`setupTestDb`/`closeTestDb`、beforeEach TRUNCATE）。

### Task 0: 计划入库与任务板标记

- [ ] 将本计划保存为 `docs/superpowers/plans/2026-10-23-track-t-teams.md`（skill 约定位置）。
- [ ] `docs/V1_TASKS.md`：轨道 T 行状态改 🟡、填负责人 asher；T-1…T-5 各行标记 `[~]`。

### Task 1: T-1 创建团队与成员关系

**Files:**
- Create: `src/lib/slug.ts`、`src/lib/slug.test.ts`
- Create: `src/features/teams/service.ts`、`src/features/teams/service.test.ts`、`src/features/teams/actions.ts`、`src/features/teams/actions.test.ts`
- Create: `src/features/teams/components/CreateTeamForm.tsx`
- Create: `src/app/(dashboard)/teams/new/page.tsx`
- Modify: `src/features/teams/components/TeamsNav.tsx`（唯一允许改的导航文件）

**Interfaces（Produces，后续步骤消费）:**
```ts
// service.ts
export class TeamError extends Error { code: "VALIDATION" | "SLUG_FAILED"; field: "name" | "form" }
export interface CreateTeamInput { name: string }              // trim 后 2–30 字符，必填
export async function createTeam(input: CreateTeamInput, actorId: string, client?: DbClient): Promise<Team>
export async function getTeamBySlug(slug: string, client?: DbClient): Promise<Team | null>
export async function listTeamsForUser(userId: string, client?: DbClient): Promise<Team[]>   // createdAt 升序
// actions.ts（"use server"）
export async function createTeamAction(input: CreateTeamInput): Promise<ActionResult<Team>>
// lib/slug.ts（纯函数）
export function slugifyName(name: string): string   // 小写；连续 [a-z0-9] 片段以 "-" 连接；截断 40；空 → "team"
export function slugWithCounter(base: string, n: number): string  // n===1 ? base : `${base}-${n}`
```
- 事务：`db.transaction` 内插 team + owner membership（`role: "owner"`）。
- slug 唯一性：n=1..50 以 `like(base + '%')` 查库取空闲计数，再以 23505 重试兜底（≤5 次）；`errorChain`/`isUniqueViolation` 从 `auth/service.ts:113-133` 提取为共享 `src/server/db/errors.ts`（auth 改为 re-export/引用，行为不变）。
- `CreateTeamForm`：复制 `LoginForm.tsx` 模式（`form.setFields` 字段错 + `Alert` form 错）；成功 `router.push("/teams/${slug}/settings")` + `router.refresh()`（settings 页 Step 3 才建，push 404 只在 Step1→3 间临时存在，可接受；若介意可先 `/my`，Step 3 一并切换）。
- `TeamsNav`：改 async，`getCurrentUser()` null → 返回 null；`listTeamsForUser` 渲染 `NavSection title="我的团队"`，每项 `Link href={/teams/${slug}/settings}`；末尾「＋ 创建团队」→ `/teams/new`。

**关键测试：**
- `slug.test.ts`：ASCII → 小写连字符；纯中文 → `"team"`；混合 `"T2 增长"` → `"t2"`；长名截断 40。
- `service.test.ts`：创建成功返回 Team 且 owner membership 自动建立（role=owner）；名字过短/过长 → `TeamError VALIDATION field name`；同名 slug 递增 `team-2` 不冲突；纯中文名 slug=`team`；`listTeamsForUser` 只含所在团队且按创建时间排序；`getTeamBySlug` 不存在 → null。
- `actions.test.ts`（`vi.mock("@/features/auth/session")`）：未登录 → `{ ok:false, errors:{form:"请先登录"} }`；成功路径 `ok:true`。

**Commit:** `feat(teams): team creation with owner membership, slug generation and sidebar wiring`

### Task 2: T-4 角色与权限判定层 + 只读成员列表

**Files:**
- Create: `src/features/teams/permissions.ts`、`src/features/teams/permissions.test.ts`（纯函数，无 DB）
- Modify: `src/features/teams/service.ts`（增 `renameTeam`、`listMembers`）与 `service.test.ts`
- Create: `src/features/teams/components/MemberList.tsx`（server 组件）

**Interfaces:**
```ts
// permissions.ts
export type TeamRole = "owner" | "admin" | "member";
export type TeamAction =
  | "team:view" | "team:rename" | "team:invite" | "team:remove_member"
  | "team:manage_projects" | "team:dissolve" | "team:transfer" | "team:leave";
export class TeamPermissionError extends Error { readonly action: TeamAction }  // 全仓唯一可映射 403 的错误类
export function can(role: TeamRole | null, action: TeamAction): boolean
export function assertCan(role: TeamRole | null, action: TeamAction): void
export async function getMembership(teamId: string, userId: string, client?: DbClient): Promise<TeamMembership | null>
// service.ts 追加
export async function renameTeam(input: { teamId: string; actorId: string; name: string }, client?: DbClient): Promise<Team>  // slug 不变
export interface MemberView { membership: TeamMembership; user: { id: string; uid: string; username: string } }
export async function listMembers(teamId: string, client?: DbClient): Promise<MemberView[]>  // joinedAt 升序
```
- 权限矩阵（设计 §5，`it.each` 表驱动）：`team:view` → 所有非 null 角色；`rename/invite/remove_member/manage_projects` → owner+admin；`dissolve/transfer` → 仅 owner；`leave` → admin+member=true、**owner=false**（编码"owner 须先转让/解散"，G 直接 assertCan）；`role=null`（非成员）→ 全 false。`can` 是唯一矩阵实现处。

**关键测试：** `permissions.test.ts` 覆盖上表每一格 + `assertCan` 抛 `TeamPermissionError` 且带 `action`；`service.test.ts`：`getMembership` 命中/未命中；`renameTeam` owner 成功且 slug 不变、member 与非成员 → `TeamPermissionError`；`listMembers` 字段与排序。

**Commit:** `feat(teams): role permission layer with matrix tests and read-only member list`

### Task 3: T-2 按 UID 发起邀请与撤销（建设置页骨架）

**Files:**
- Create: `src/features/teams/invites/service.ts`、`invites/service.test.ts`、`invites/actions.ts`、`invites/actions.test.ts`
- Create: `src/features/teams/components/InviteMemberForm.tsx`、`RescindInviteButton.tsx`
- Create: `src/app/(dashboard)/teams/[teamSlug]/settings/page.tsx`
- Modify: `src/features/teams/actions.test.ts`（若 Step1 临时用 `/my`，此处切到 settings）

**Interfaces:**
```ts
// invites/service.ts
export class InviteError extends Error { code: "UID_NOT_FOUND" | "SELF" | "ALREADY_MEMBER" | "PENDING_EXISTS" | "INVALID" | "VALIDATION"; field: "uid" | "form" }
export interface CreateInviteInput { teamId: string; actorId: string; uid: string }
export async function createInvite(input: CreateInviteInput, client?: DbClient): Promise<TeamInvite>
export async function rescindInvite(input: { inviteId: string; teamId: string; actorId: string }, client?: DbClient): Promise<TeamInvite>
export interface SentInviteView { invite: TeamInvite; invitee: { id: string; uid: string; username: string } }
export async function listPendingSentInvites(teamId: string, client?: DbClient): Promise<SentInviteView[]>
// invites/actions.ts
export async function createInviteAction(input: CreateInviteInput): Promise<ActionResult<TeamInvite>>
export async function rescindInviteAction(input: { inviteId: string; teamId: string }): Promise<ActionResult<TeamInvite>>
```
- `createInvite`：`assertCan(team:invite)` → `findByUid`（空/不存在/非 `doing_` 前缀 → `UID_NOT_FOUND`/`"uid"`/「UID 无效」）→ 邀请自己/已是成员/已有 pending 各自友好错误 → 事务内插 invite + `createNotification({ userId: inviteeId, type: "team_invite", teamId, actorId }, tx)`（INT-1 核验点）。
- `rescindInvite`：`assertCan(team:invite)`；仅 pending 可撤销 → 置 `rescinded`（`respondedAt` 保持 null）+ 通知 invitee。
- **设置页**（RSC）：`getTeamBySlug` → null 或 `getMembership` → null 均 `notFound()`（Review Focus #4）。member：仅「成员（N）」`MemberList`；owner/admin：加「邀请成员」卡（文案对照 team-settings.html：**输入对方 UID 即可邀请，对方登录后处理。**、`doing_` 前缀展示、**已发出 · 待处理（N）** + 撤销按钮）。角色 tag 用 antd Tag 内联配色（所有者/管理员 primary、成员 muted）——`StatusTag` 是任务状态专用，不复用。

**关键测试：** owner/admin 可发起、member → `TeamPermissionError`；UID 空/不存在 → field `uid`「UID 无效」；邀请自己/已是成员/重复 pending 三类错误；**同 (team,invitee) 第二条 pending 直插被部分唯一索引 23505 拒绝**（DB 兜底验证）；invite 落库后 `notifications` 表出现 `type='team_invite'` 且 teamId/actorId 正确；撤销 pending→rescinded+通知、非 pending 撤销报错、member 撤销被拒；`actions.test.ts`：member 直调 `createInviteAction` → `ok:false`。

**Commit:** `feat(teams): UID invites with rescind, team settings skeleton and invite notifications`

### Task 4: T-5 团队改名（设置页基础）

**Files:**
- Create: `src/features/teams/components/RenameTeamForm.tsx`
- Modify: `src/app/(dashboard)/teams/[teamSlug]/settings/page.tsx`（owner/admin 渲染「团队信息」卡，hint「创建于 YYYY-MM-DD」）；`src/features/teams/actions.ts`（增 `renameTeamAction(input: { teamId: string; name: string }): Promise<ActionResult<Team>>`）；`actions.test.ts`

**关键测试：** owner 改名后 slug 不变、`listTeamsForUser` 立即反映新名（service 级 owner/admin/member 断言 Step 2 已覆盖）；`actions.test.ts`：member 直调 `renameTeamAction` → `ok:false`。UI：成功 `message.success("已保存")` + `router.refresh()`。

**Commit:** `feat(teams): team rename in settings page with role-gated sections`

### Task 5: T-3 邀请接受 / 拒绝与邀请页

**Files:**
- Modify: `src/features/teams/invites/service.ts`（增 `respondToInvite`、`listReceivedInvites` + view 类型）、`invites/actions.ts`（增 `respondToInviteAction(input: { inviteId: string; accept: boolean })`）、两测试文件
- Create: `src/app/(dashboard)/invites/page.tsx`、`src/features/teams/invites/components/InviteRespondButtons.tsx`
- Modify: `src/features/teams/components/TeamsNav.tsx`（追加「账号」分组「待处理邀请」+ pending 数角标）

**Interfaces:**
```ts
export async function respondToInvite(input: { inviteId: string; actorId: string; accept: boolean }, client?: DbClient): Promise<Team>
// invite 不存在/非本人/非 pending → InviteError("INVALID","邀请不存在或已失效","form")（覆盖已撤销与团队已解散两种失效）
// accept：事务 { 插 membership(role:"member")，置 accepted+respondedAt，通知 inviter }
// decline：事务 { 置 declined+respondedAt，通知 inviter }
export interface ReceivedInviteView { invite: TeamInvite; team: { id: string; name: string; slug: string };
                                       invitedBy: { id: string; username: string; uid: string }; memberCount: number }
export async function listReceivedInvites(userId: string, client?: DbClient): Promise<ReceivedInviteView[]>  // pending 在前
```
- `invites/page.tsx`（RSC，文案对照 invites.html）：页头「待处理邀请」+ 副标 **通过 UID 收到的团队邀请，接受后即可参与团队项目。**；UID 说明 callout；「待处理（N）」卡片（团队名、邀请人 avatar+名+mono UID、相对时间、成员数）+ `InviteRespondButtons`（失败 `message.error(errors.form)` = 失效提示而非报错页）；「已处理」表格（团队名 + 已接受/已拒绝 tag + 日期）；空态 `EmptyState`。
- 失效提示的场景全部走 `INVALID`：已撤销、团队已解散（invite 行级联删除 → 同错误）、已响应、非本人。

**关键测试：** accept → membership(member) 建立、invite 置 accepted、respondedAt 非空、通知 inviter、该团队进入 `listTeamsForUser`；decline → declined、无 membership、通知 inviter；撤销后响应/团队解散后响应 → `INVALID`（不 500）；非受邀人响应 → 失败；`listReceivedInvites` pending 在前且带 team/invitedBy/memberCount。

**Commit:** `feat(teams): received invites page with accept and decline flow`

### Task 6: 收尾核验

- [ ] `pnpm test`（含 DB 测试，需本机 `open_doing_group` 或 `open_doing_test` 库与 `TEST_DATABASE_URL`）、`pnpm -r typecheck && lint && build` 全绿。
- [ ] `docs/V1_TASKS.md` 勾选 T-1…T-5 验收项，任务板轨道 T 状态 ✅。
- [ ] 浏览器冒烟（dev -p 3002）：注册两个账号 → A 建团队 → 拿 B 的 UID 发邀请 → B 在 /invites 接受 → 两人侧栏同见团队；member 账号直访设置页只见成员表。
- [ ] 在任务板备注两条 INT-1 议题：SpaceSwitcher 数据接线、团队导航链接目标改指概览页（D 落地后）。

## Verification（端到端）

1. 单测：`pnpm test` —— permissions 矩阵表驱动全绿、invites 全生命周期 + 23505 兜底 + 通知落库断言通过。
2. 静态：`pnpm -r typecheck && pnpm -r lint && pnpm --filter @open-doing/web build`。
3. 手工冒烟：双人两浏览器完成 M1 出口检查的邀请闭环（见 Step 6）；未登录访问 /invites → /login。
