# 轨道 G：团队治理与生命周期实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 落地 `docs/V1_TASKS.md` §8 轨道 G：移除成员（G-1）、主动退出（G-2）、转让/解散（G-3）、设置页整合（G-4）。

**Architecture:** 新建 `src/features/teams/members/{service,actions}.ts`（governance 域，T 的 `service.ts` 不动），复用 T-4 的 `TeamAction` 权限判定（`team:remove_member/leave/dissolve/transfer` 已在 `permissions.ts:14-22`）；UI 在 T 轨道设置页骨架上追加危险区与成员管理控件（G-4）。全部写操作走 Server Actions + `ActionResult<T>`，action 端再鉴权；离开/移除语义统一为"任务保留、assignee 置空"。

**Tech Stack:** Next.js 16 App Router + React 19 + antd v6 + Drizzle/PostgreSQL + Vitest（DB 用例走 `TEST_DATABASE_URL`）。

**Spec:** `docs/V1_TASKS.md` §8 轨道 G（G-1..G-4）；文案对照 `docs/prototypes/team-settings.html`（转让团队/危险操作/解散团队）。

## Global Constraints

- 权限矩阵（设计文档 §5）：移除/邀请 owner+admin；转让/解散**仅 owner**；member 一切治理操作被拒（action 端 `assertCan` → `TeamPermissionError`，不只隐藏按钮）。
- 移除/退出语义：membership 删除；被移除人**负责的任务保留并 `assignee_id=null`**（只清该团队范围内的任务：`project_id ∈ 该团队项目`）；其不再能看到团队任何数据（`getMembership` 返回 null → 各服务自然过滤）。
- 移除 owner 被阻止（须先转让）；owner 退出被拒并提示先转让或解散（文案对齐原型危险区）。
- 转让后角色互换：新 owner 获得 `owner` 角色与 `teams.owner_id`，**原 owner 降为 `admin`**；团队内恰一个 owner。
- 解散为**硬删除 + 级联**（DB 外键 `ON DELETE CASCADE` 兜底：项目/任务/子任务/评论/邀请/成员关系/通知）；UI 二次确认（`ConfirmModal`）；解散后所有旧 URL 404、侧栏不再出现。
- 权限错误统一 `TeamPermissionError` 一类；不新增错误类型。
- 中文文案/注释；commit 英语；不新增依赖；RSC + client 组件分离；样式只用令牌。
- 测试真库无 mock（`setupTestDb` 模式，参照 `features/teams/invites/service.test.ts`）；收尾全量绿。

## Review Focus

1. **移除/退出后可见性**：被移除人 `getMembership` 变 null，此后其调任何团队服务拿不到数据 → Task 1 测试。
2. **assignee 置空范围**：只清**该团队**任务（被移除人在其他团队/个人的任务不受影响）→ Task 1 测试。
3. **owner 保护**：移除 owner、owner 退出均被阻；转让后团队恰一个 owner、旧 owner 变 admin → Task 1/3 测试。
4. **解散级联完整性**：解散后 projects/tasks/subtasks/comments/team_invites/team_memberships/notifications 关联行全部消失（DB cascade 验证，测试直查各表计数 = 0）→ Task 3 测试。
5. **member 直调 action**：不显示按钮但直调 service/action 仍 403 → Task 1/2 测试。

---

### Task 1: G-1/G-2 移除成员与主动退出（service + actions + 测试）

**Files:**
- Create: `apps/web/src/features/teams/members/service.ts`
- Create: `apps/web/src/features/teams/members/service.test.ts`
- Create: `apps/web/src/features/teams/members/actions.ts`

**Interfaces:**
- Consumes: `assertCan`/`getMembership`/`TeamPermissionError`（`features/teams/permissions.ts`）、`TeamAction`（`team:remove_member`/`team:leave`）、`ActionResult<T>`（`features/auth/actions`）、`getCurrentUser`（session）。
- Produces（Task 4 UI 消费）:
  ```ts
  export async function removeMember(input: { teamId: string; targetUserId: string; actorId: string }, client?: DbClient): Promise<void>
  // assertCan(actor 的 membership, 'team:remove_member')；target 为 owner → TeamPermissionError（须先转让）；
  // target 非成员 → 领域错误「成员不存在或已退出」；同事务：删 membership + update tasks set assigneeId=null
  //   where assigneeId=target and projectId in (select id from projects where team_id=...)。
  export async function leaveTeam(input: { teamId: string; actorId: string }, client?: DbClient): Promise<void>
  // actor 为 owner → TeamPermissionError（文案「请先转让团队或解散团队」）；其余同 removeMember 语义（自删 + assignee 置空）。
  export async function removeMemberAction(input: { teamSlug: string; targetUserId: string }): Promise<ActionResult<null>>
  export async function leaveTeamAction(input: { teamSlug: string }): Promise<ActionResult<null>>
  // action 端：getCurrentUser 鉴权 → slug 解析 teamId（getTeamBySlug，非成员/不存在返回 { ok:false, errors:{form:'团队不存在或无权访问'} }）
  // → 调 service；成功后 revalidatePath('/', 'layout')（侧栏团队列表刷新）。
  ```

- [ ] **Step 1: 写失败测试**（seed：owner+admin+member+外人；member 名下该团队项目任务 + 该 member 在**另一团队**的任务 + 个人任务）
  - admin 移除 member：membership 消失；该团队内其任务 assignee=null 且任务仍在；**另一团队与个人任务不受影响**（Review Focus 2）。
  - 移除后被移除人 `getMembership` 为 null（Review Focus 1）；再次移除同一人报「成员不存在或已退出」。
  - admin 移除 owner → TeamPermissionError（Review Focus 3）；member 调 removeMember → TeamPermissionError（Review Focus 5）。
  - owner `leaveTeam` → TeamPermissionError；member `leaveTeam` 成功且同移除语义。
  - action 未登录 → `{ ok:false, errors:{form:'请先登录'} }`（mock 模式参照 `invites/actions.test.ts`）。
- [ ] **Step 2: 跑测试确认失败** — `pnpm exec vitest run --project web apps/web/src/features/teams/members/service.test.ts`
- [ ] **Step 3: 实现 service + actions**（assignee 置空用子查询单条 UPDATE；`removeMember` 里 actor 与 target 的 membership 同事务内取）
- [ ] **Step 4: 跑测试通过**；`pnpm --filter @open-doing/web typecheck`
- [ ] **Step 5: Commit** — `feat(teams): remove member and leave team with assignee handoff`

### Task 2: G-3 转让与解散（service + actions + 测试）

**Files:**
- Modify: `apps/web/src/features/teams/members/service.ts`（追加）
- Modify: `apps/web/src/features/teams/members/service.test.ts`（追加）
- Modify: `apps/web/src/features/teams/members/actions.ts`（追加）

**Interfaces:**
- Consumes: `TeamAction`（`team:transfer`/`team:dissolve`）、既有权限函数。
- Produces:
  ```ts
  export async function transferTeam(input: { teamId: string; targetUserId: string; actorId: string }, client?: DbClient): Promise<void>
  // 仅 owner；target 必须是现有成员（否则领域错误）；同事务：teams.owner_id=target、
  //   target membership role='owner'、actor membership role='admin'（Review Focus 3：唯一 owner 保持）。
  export async function dissolveTeam(input: { teamId: string; actorId: string }, client?: DbClient): Promise<void>
  // 仅 owner；delete teams 行（DB cascade 兜底全部关联）；返回前无需手动删子表。
  export async function transferTeamAction(input: { teamSlug: string; targetUserId: string }): Promise<ActionResult<null>>
  export async function dissolveTeamAction(input: { teamSlug: string }): Promise<ActionResult<null>>
  // 成功后 revalidatePath('/', 'layout')；dissolve 额外 redirect 由 UI 层处理（action 只返回 ok）。
  ```
- [ ] **Step 1: 写失败测试**
  - owner 转让给 admin：owner_id 变更、admin→owner、原 owner→admin；`listMembers` 恰一个 owner；admin/member 调 transfer → TeamPermissionError；转让给非成员 → 领域错误。
  - member 调 dissolve → TeamPermissionError（Review Focus 5）。
  - owner 解散：teams 行删 + `projects/tasks/subtasks/comments/team_invites/team_memberships/notifications` 各表该团队关联行计数全 0（Review Focus 4）；解散后 `getTeamBySlug` null。
  - 解散后再调 transfer/dissolve → 团队不存在错误。
- [ ] **Step 2: 跑测试确认失败**
- [ ] **Step 3: 实现**（两个函数 + 两个 action）
- [ ] **Step 4: 跑测试通过**；typecheck
- [ ] **Step 5: Commit** — `feat(teams): transfer ownership and dissolve team with cascade`

### Task 3: G-4 设置页整合（成员管理 + 危险区 UI）

**Files:**
- Create: `apps/web/src/features/teams/members/components/RemoveMemberButton.tsx`（client，`ConfirmModal` 二次确认）
- Create: `apps/web/src/features/teams/members/components/LeaveTeamButton.tsx`（client；member/admin 可见）
- Create: `apps/web/src/features/teams/members/components/TransferTeamButton.tsx`（client；owner 可见；成员下拉选择）
- Create: `apps/web/src/features/teams/members/components/DissolveTeamButton.tsx`（client；danger 样式 `ConfirmModal`，文案对齐原型「解散团队」危险区）
- Modify: `apps/web/src/app/(dashboard)/teams/[teamSlug]/settings/page.tsx`（按角色分区渲染；替换 T 的 `MemberList` 为带移除按钮的版本或在其下追加操作列）

**Interfaces:**
- Consumes: Task 1/2 的四个 actions；`can(membership.role, action)`；`ConfirmModal`（共享件）；`UserAvatar`。
- Produces: 设置页分区——「成员」（owner/admin 每行移除按钮、owner 行不显示；member 只读）、「邀请区」（T-2 既有，不动）、「危险操作」（对齐原型：member/admin 见「退出团队」，owner 见「转让团队」+「解散团队」；文案：退出被拒提示「请先转让团队或解散团队」）。区块按角色显隐 + action 端已鉴权。
- [ ] **Step 1: 实现四个 client 组件**（统一模式：按钮 → ConfirmModal → 调 action → 成功 `message.success` + `router.refresh()`；失败展示 `errors.form`）
- [ ] **Step 2: 设置页分区接线**（owner/admin/member 三种角色渲染分支；解散成功后 `router.push('/my')`）
- [ ] **Step 3: 验证** — typecheck/lint/全量测试绿；`pnpm dev -p 3006` 手工冒烟：member 退出→侧栏消失+任务置空；admin 移除 member；owner 转让→角色互换；解散→团队 404+侧栏消失（冒烟数据清理）
- [ ] **Step 4: Commit** — `feat(teams): governance controls on team settings page`

### Task 4: 收尾——任务板回写 + 全量检查 + INT-3

**Files:**
- Modify: `docs/V1_TASKS.md`（G-1..G-4 验收勾选、轨道表 G 行 ⬜→✅ 负责人 asher；INT-3 三项勾选：D/G 已合入 main、全量绿+角色矩阵冒烟、tag **`m3-frozen`**）

- [ ] **Step 1:** `pnpm -r typecheck && pnpm -r lint && pnpm -r test` + build（显式 `DATABASE_URL`）全绿
- [ ] **Step 2:** 按角色矩阵手工冒烟（owner/admin/member/非成员/他人个人空间 404）
- [ ] **Step 3:** 任务板回写（G 全部 + INT-3 勾选），commit 后合入 main 并打 tag **`m3-frozen`**
- [ ] **Step 4: Commit** — `docs(tasks): mark track G and INT-3 complete`
