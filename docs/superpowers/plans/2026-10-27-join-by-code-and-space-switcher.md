# Join-by-Code & Space Switcher (S1–S4) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 团队支持「凭 8 位加入码申请加入 + owner/admin 审批」的正向加入模型,并把 SpaceSwitcher 从静态桩实装为真实的空间导航菜单。

**Architecture:** 复用 v1 邀请流全部模式——`teams` 表加 `join_code`/`join_code_enabled` 列;新表 `team_join_requests` 带部分唯一索引;新领域模块 `features/teams/joins/`(service + actions + components)镜像 `features/teams/invites/`;3 个新 `NotificationType` 同事务写入;SpaceSwitcher 维持 `/my` 与 `/teams/[teamSlug]` 双路由树,由 `Sidebar`(server)供数。

**Tech Stack:** Next.js 16 App Router + React 19 + antd v6 + Tailwind 4(关 preflight)+ Drizzle ORM + PostgreSQL;Vitest(仓库根,串行)。

**Spec:** `docs/V1.1_TASKS.md` §S1–S4(含 2026-10-27 已定裁决);全局约束沿 `docs/V1_TASKS.md` §2。

## Global Constraints

- Next.js 16.4.2:写 Next 相关代码前读 `apps/web/node_modules/next/dist/docs/` 相关指南。
- 技术栈冻结;Server Actions 返回统一 `ActionResult<T>`;每个 action 独立鉴权(`getCurrentUser()` → 未登录 `{ ok: false, errors: { form: "请先登录" } }`)。
- 页面 RSC 取数;antd 交互件只在 `"use client"` 组件中。
- 权限判定只用 `features/teams/permissions` 的 `can`/`assertCan`;本计划全部管理动作复用 `"team:invite"`(owner/admin),**不新增 TeamAction 名**。
- 通知与业务写入**同一事务**;`createNotification(input, tx)`。
- 中文文案、中文注释密度与现有代码一致;**commit message 一律英语**,且以 `Co-Authored-By: Claude Code <noreply@anthropic.com>` 结尾。
- 数据库测试需要 `set -a; source apps/web/.env.local; set +a` 后再跑;vitest 串行(`fileParallelism: false`),不要改并行配置。
- 破坏性操作(取消申请、拒绝申请、重置加入码)一律 `ConfirmModal` 二次确认。
- 颜色取自设计令牌值(参照现有组件的 hex),不发明新色值。
- 每任务收尾:`pnpm --filter @open-doing/web test` 相关文件通过;最终任务跑全量 `pnpm test / lint / typecheck / build`。

## Review Focus

- **加入码输入不规范**:用户粘贴小写/带空格的码(如 `k7m2 9xq4`)。预期:service 层 `trim + toUpperCase` 后校验;含空格等非法字符报「加入码格式不正确」字段错误,而不是 500。→ Task 4 测试钉住。
- **并发双审批**:两个 admin 同时批准同一申请。预期:后到者得到「申请不存在或已失效」(`INVALID`),不产生重复 membership;若与邀请接受竞态撞 membership 唯一约束,得「该用户已是团队成员」且回滚(申请保持 pending 可再处理)。→ Task 4 测试钉住。
- **加入码枚举/泄露**:无效码与未开放码报不同错(`CODE_INVALID` / `JOIN_DISABLED`)只暴露给持码人,可接受;但服务层不得在错误信息中回显团队名。→ Task 4 实现约束。
- **通知洪泛**:`team_join_*` 通知 `task_id` 为 null,不享受幂等索引;每次申请/审批各产生一条,可接受;**取消申请不产生通知**。→ Task 4 测试钉住取消无通知。
- **路由遮蔽**:`/teams/join` 是静态段,优先于 `[teamSlug]` 动态段(Next.js 静态优先),但 `getTeamBySlug("join")` 永远 404 必须不发生——静态页存在即遮蔽,无需处理,但不得把 join/slug 当作真实团队 slug 查库。→ Task 6 实现注意,由 X1 的 e2e 兜底。

---

### Task 1: `generateJoinCode` 工具函数

**Files:**
- Create: `apps/web/src/lib/join-code.ts`
- Test: `apps/web/src/lib/join-code.test.ts`

**Interfaces:**
- Produces: `generateJoinCode(): string` — 8 位大写码,字符集 `23456789ABCDEFGHJKMNPQRSTUVWXYZ`(31 字符,31⁸ ≈ 8.5×10¹¹ 不可枚举);Task 3/4 消费。

- [ ] **Step 1: 写失败测试**

镜像 `apps/web/src/lib/uid.test.ts` 的风格,断言:长度恒为 8;200 次采样全部落在字符集内;200 次采样去重后 ≥ 150(分布健全性);不含 `I`/`L`/`O`。

- [ ] **Step 2: 运行确认失败**

Run: `pnpm vitest run apps/web/src/lib/join-code.test.ts`
Expected: FAIL(模块不存在)

- [ ] **Step 3: 实现 `apps/web/src/lib/join-code.ts`**

照抄 `src/lib/uid.ts` 的 node:crypto + 拒绝采样骨架,替换:`ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ"`、`JOIN_CODE_LENGTH = 8`、无前缀。注释说明与 UID 的关系(同族生成器、为何大写、为何无前缀)。

- [ ] **Step 4: 运行确认通过**

Run: `pnpm vitest run apps/web/src/lib/join-code.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/join-code.ts apps/web/src/lib/join-code.test.ts
git commit -m "feat(lib): add join-code generator"
```

---

### Task 2: 共享类型扩展 + 通知文案与跳转

**Files:**
- Modify: `packages/types/src/index.ts`(NotificationType 联合、新增 TeamJoinRequest)
- Modify: `apps/web/src/features/notifications/components/notification-format.ts`
- Modify: `apps/web/src/features/notifications/components/NotificationBell.tsx`(`typeColors` switch)
- Modify: `apps/web/src/features/notifications/queries.ts`(`buildNotificationHref` 及其读模型取数)
- Test: `apps/web/src/features/notifications/components/notification-format.test.ts`、`apps/web/src/features/notifications/queries.test.ts`

**Interfaces:**
- Produces: `type TeamJoinStatus = "pending" | "approved" | "declined" | "cancelled"`;`interface TeamJoinRequest { id: string; teamId: string; userId: string; status: TeamJoinStatus; createdAt: string; respondedAt?: string; respondedById?: string }`;`NotificationType` 增加 `"team_join_requested" | "team_join_approved" | "team_join_declined"`。Task 4/5 消费。

- [ ] **Step 1: 写失败测试**

`notification-format.test.ts` 新增用例(纯函数):
- `team_join_requested`,actor=「周牧」,teamName=「增长突击队」→ parts `[{"周牧", bold}, " 申请加入团队「增长突击队」"]`;
- `team_join_approved` → `["周牧", " 通过了你加入「增长突击队」的申请"]`;
- `team_join_declined` → `["周牧", " 拒绝了你加入「增长突击队」的申请"]`;
- actorName 为 null 时走既有无主体分支。

`queries.test.ts` 的 `buildNotificationHref` 用例:
- `{ type: "team_join_requested", teamSlug: "growth" }` → `"/teams/growth/settings"`;
- `{ type: "team_join_approved" }` / `{ type: "team_join_declined" }` → `"/invites"`(teamSlug 缺失也返回 /invites);
- 既有用例回归不变。

- [ ] **Step 2: 运行确认失败**

Run: `pnpm vitest run apps/web/src/features/notifications`
Expected: FAIL(联合类型未扩展,字面量报错)

- [ ] **Step 3: 实现**

1. `packages/types/src/index.ts`:扩展 `NotificationType` 联合;在 `TeamInvite` 后新增 `TeamJoinStatus` / `TeamJoinRequest`(注释风格与相邻类型一致,注明「凭码申请加入」语义与状态机)。
2. `notification-format.ts`:三个新 case,用现有 `withActor` 组装,文案如上。
3. `NotificationBell.tsx` 的 `typeColors`:`team_join_requested` → `{ color: token.colorPrimary, background: token.colorPrimaryBg }`(待办感);`team_join_approved` → colorSuccess/successBg;`team_join_declined` → colorTextSecondary/colorFillSecondary。
4. `queries.ts` 的 `buildNotificationHref`:`team_join_requested` 且有 `teamSlug` → `/teams/{teamSlug}/settings`,缺失 → `null`;两个结果类型 → `"/invites"`。检查该文件组装 `NotificationListItem` 的查询(≈166 行 `buildNotificationHref` 调用处):确认 join 已取 `teams.slug`,若无则在 select 中补 `teamSlug: teams.slug` 并透传。

- [ ] **Step 4: 运行确认通过**

Run: `pnpm vitest run apps/web/src/features/notifications`
Expected: PASS(typecheck 层面两个 switch 的穷尽性由编译保证)

- [ ] **Step 5: Commit**

```bash
git add packages/types/src/index.ts apps/web/src/features/notifications
git commit -m "feat(types): add team-join request model and notification types"
```

---

### Task 3: schema + 迁移(含存量回填)+ createTeam 接线

**Files:**
- Modify: `apps/web/src/server/db/schema.ts`
- Create: `apps/web/drizzle/00XX_join_code.sql`(由 db:generate 生成后手工插入回填段)
- Modify: `apps/web/src/server/db/schema.test.ts`(新增行为用例)
- Modify: `apps/web/src/features/teams/service.ts`(`createTeam` 写入 joinCode——必须与 NOT NULL 同任务落地,否则迁移后建团队即违反非空约束)

**Interfaces:**
- Produces: `teams.joinCode` / `teams.joinCodeEnabled`(Drizzle 列);`teamJoinRequests` 表导出;`createTeam` 保证新团队带 8 位 joinCode。Task 4 消费。

- [ ] **Step 1: 修改 `schema.ts`**

1. `teams` 表:`joinCode: text("join_code")` + `joinCodeEnabled: boolean("join_code_enabled").notNull().default(true)`;`join_code` 的唯一性用表级 `uniqueIndex("teams_join_code_unique").on(t.joinCode)`(**不用**列上 `.unique()`,让迁移产出独立的 CREATE UNIQUE INDEX,便于把回填插在它之前)。
2. 新表 `teamJoinRequests`(`team_join_requests`):`id` uuid pk defaultRandom;`teamId` → teams cascade;`userId` → users cascade;`status: text().$type<TeamJoinStatus>().notNull().default("pending")`;`createdAt` timestamptz notNull defaultNow;`respondedAt` timestamptz 可空;`respondedById` uuid → users cascade 可空。表约束:`uniqueIndex("team_join_requests_pending_team_user_unique").on(t.teamId, t.userId).where(sql\`${t.status} = 'pending'\`)`(镜像 teamInvites 写法)+ `index("team_join_requests_user_id_idx").on(t.userId)`(「我的申请」查询)。文件头决策注释同步补充。
3. `features/teams/service.ts` 的 `createTeam`:`.values({ name, slug, joinCode: generateJoinCode(), ownerId })`(import 自 Task 1 的 `@/lib/join-code`)。

- [ ] **Step 2: 生成迁移并手工插回填段**

Run: `set -a; source apps/web/.env.local; set +a && pnpm db:generate`

编辑生成的 SQL,调整为以下顺序(回填必须发生在 SET NOT NULL / CREATE UNIQUE INDEX 之前):

```sql
ALTER TABLE "teams" ADD COLUMN "join_code" text;
ALTER TABLE "teams" ADD COLUMN "join_code_enabled" boolean DEFAULT true NOT NULL;
DO $$
DECLARE t record; code text;
BEGIN
  FOR t IN SELECT id FROM teams LOOP
    LOOP
      code := (SELECT string_agg(ch, '') FROM (
        SELECT substr('23456789ABCDEFGHJKMNPQRSTUVWXYZ', 1 + floor(random() * 31)::int, 1) AS ch
        FROM generate_series(1, 8)) s);
      BEGIN
        UPDATE teams SET join_code = code WHERE id = t.id;
        EXIT;
      EXCEPTION WHEN unique_violation THEN NULL;
      END;
    END LOOP;
  END LOOP;
END $$;
ALTER TABLE "teams" ALTER COLUMN "join_code" SET NOT NULL;
CREATE UNIQUE INDEX "teams_join_code_unique" ON "teams" ("join_code");
-- team_join_requests 建表 DDL(生成的原样保留)
```

- [ ] **Step 3: 对开发库执行迁移**

Run: `set -a; source apps/web/.env.local; set +a && pnpm db:migrate`
Expected: 迁移成功;`SELECT count(*) FROM teams WHERE join_code IS NULL` 为 0。

- [ ] **Step 4: 写 schema 行为测试并运行**

`schema.test.ts` 新增(镜像既有风格):
- 创建团队后 `joinCode` 非空且 8 位、`joinCodeEnabled` 默认 true;
- 同库两条团队 join_code 不冲突;
- 插入两条同 (team, user) 且均 pending 的 join request → 第二条唯一冲突;第一条改为 declined 后可再插入 pending;
- 删除团队 → 其 join requests 级联消失;
- `createTeam` 建出的团队 joinCode 非空、8 位(在 `teams/service.test.ts` 中补此条)。

Run: `set -a; source apps/web/.env.local; set +a && pnpm vitest run apps/web/src/server/db/schema.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/server/db/schema.ts apps/web/src/server/db/schema.test.ts apps/web/src/features/teams/service.ts apps/web/drizzle
git commit -m "feat(db): add team join code and join requests schema"
```

---

### Task 4: joins service(+ createTeam 接线)

**Files:**
- Create: `apps/web/src/features/teams/joins/service.ts`
- Test: `apps/web/src/features/teams/joins/service.test.ts`

**Interfaces:**
- Consumes: `generateJoinCode()`(Task 1)、`teamJoinRequests` 表与已接线的 `createTeam`(Task 3)、`assertCan`/`getMembership`/`createNotification`/`isUniqueViolation`、`TeamJoinRequest` 类型(Task 2)。
- Produces(Task 5/6/7 依赖的精确签名):

```ts
export class JoinError extends Error {
  readonly code: "VALIDATION" | "CODE_INVALID" | "JOIN_DISABLED" | "ALREADY_MEMBER" | "PENDING_EXISTS" | "INVALID";
  readonly field: "code" | "form";
}
export interface TeamJoinRequestView { request: TeamJoinRequest; user: { id: string; username: string; uid: string } }
export interface MyJoinRequestView { request: TeamJoinRequest; team: { id: string; name: string; slug: string } }
export interface TeamJoinSettings { joinCode: string; joinCodeEnabled: boolean }

getTeamJoinSettings(teamId: string, client?): Promise<TeamJoinSettings>
resetJoinCode(input: { teamId: string; actorId: string }, client?): Promise<string>          // 返回新码
setJoinCodeEnabled(input: { teamId: string; actorId: string; enabled: boolean }, client?): Promise<void>
createJoinRequest(input: { code: string; actorId: string }, client?): Promise<TeamJoinRequest>
respondToJoinRequest(input: { requestId: string; actorId: string; approve: boolean }, client?): Promise<TeamJoinRequest>
cancelJoinRequest(input: { requestId: string; actorId: string }, client?): Promise<TeamJoinRequest>
listTeamJoinRequests(teamId: string, client?): Promise<TeamJoinRequestView[]>   // createdAt 升序
listMyJoinRequests(userId: string, client?): Promise<MyJoinRequestView[]>       // createdAt 升序
```

- [ ] **Step 1: 写失败测试**(用例清单,镜像 invites/service.test.ts 的建库/清库风格)

`createJoinRequest`:
- 码不存在 → `CODE_INVALID` field `code`;码含空格/小写归一化后合法 → 通过(`" k7m29xq4 "` ≡ 合法码);
- `join_code_enabled = false` → `JOIN_DISABLED`;
- 申请人已是成员(含团队创建者本人)→ `ALREADY_MEMBER`;
- 已有 pending → `PENDING_EXISTS`;
- 成功:返回 pending 申请;**团队 owner 与 admin 各收到一条 `team_join_requested` 通知,member 不收**;actorId = 申请人;
- declined 后可再次申请成功。

`respondToJoinRequest`:
- approve:申请转 approved + respondedAt/respondedBy;事务内建 membership(role member);申请人收到 `team_join_approved` 通知;
- decline:转 declined,申请人收到 `team_join_declined`;**不建 membership**;
- 操作者非 owner/admin → `TeamPermissionError`;非 pending(重复审批/并发第二次)→ `INVALID`;requestId 不存在 → `INVALID`;
- approve 撞 membership 唯一约束(被邀请接受竞态)→ `ALREADY_MEMBER`,事务回滚、申请保持 pending。

`cancelJoinRequest`:
- 本人取消自己的 pending → cancelled,**无任何通知产生**(查 notifications 表计数);
- 取消他人申请或非 pending → `INVALID`。

`resetJoinCode` / `setJoinCodeEnabled`:
- owner/admin 可操作,member 抛 `TeamPermissionError`;重置后旧码失效、新码可申请;enabled=false 后申请报 `JOIN_DISABLED`。

- [ ] **Step 2: 运行确认失败**

Run: `set -a; source apps/web/.env.local; set +a && pnpm vitest run apps/web/src/features/teams/joins apps/web/src/features/teams/service.test.ts`
Expected: FAIL

- [ ] **Step 3: 实现 `joins/service.ts`**

逐条对应 Review Focus 与测试:
- `createJoinRequest`:`code.trim().toUpperCase()` 后用 `/^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{8}$/` 校验;按码查团队(`CODE_INVALID`,错误信息**不含团队名**);检查 enabled → `JOIN_DISABLED`;`getMembership` → `ALREADY_MEMBER`;查 pending → `PENDING_EXISTS`;事务内 insert + 为每个 owner/admin `createNotification({ userId, type: "team_join_requested", teamId, actorId }, tx)`;unique violation → `PENDING_EXISTS`(镜像 createInvite 的 catch)。
- `respondToJoinRequest`:membership + `assertCan(role, "team:invite")`;事务内按 id 查 pending 否则 `INVALID`;update 状态与 respondedAt/respondedById;approve 分支 insert membership,catch unique violation → `ALREADY_MEMBER`(整事务回滚,申请保持 pending);`createNotification` 类型按 approve 取 `team_join_approved` / `team_join_declined`,收件人 = 申请发起人,actorId = 审批人。
- `cancelJoinRequest`:校验 `row.userId === actorId && row.status === "pending"` 否则 `INVALID`;置 cancelled;**不写通知**。
- `resetJoinCode`:循环 `generateJoinCode()` + UPDATE,unique violation 重试(镜像 nextFreeSlug 的重试上限风格,上限 5);`setJoinCodeEnabled` 单 UPDATE。
- 列表函数:join users / teams 取用户名、UID、团队名/slug;返回 ISO 时间字符串的领域对象(镜像 `toInvite`)。

- [ ] **Step 4: 运行确认通过**

Run: `set -a; source apps/web/.env.local; set +a && pnpm vitest run apps/web/src/features/teams`
Expected: PASS(含既有 invites/members/service 测试回归)

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/features/teams
git commit -m "feat(teams): join-by-code requests service with approval flow"
```

---

### Task 5: joins Server Actions

**Files:**
- Create: `apps/web/src/features/teams/joins/actions.ts`
- Test: `apps/web/src/features/teams/joins/actions.test.ts`

**Interfaces:**
- Consumes: Task 4 全部 service 函数、`ActionResult<T>`(`features/auth/actions`)、`getCurrentUser`。
- Produces(Task 6/7 依赖):

```ts
createJoinRequestAction(input: { code: string }): Promise<ActionResult<TeamJoinRequest>>
respondToJoinRequestAction(input: { requestId: string; approve: boolean }): Promise<ActionResult<TeamJoinRequest>>
cancelJoinRequestAction(input: { requestId: string }): Promise<ActionResult<TeamJoinRequest>>
resetJoinCodeAction(input: { teamId: string }): Promise<ActionResult<{ joinCode: string }>>
setJoinCodeEnabledAction(input: { teamId: string; enabled: boolean }): Promise<ActionResult<{ joinCodeEnabled: boolean }>>
```

- [ ] **Step 1: 写失败测试**

镜像 invites/actions.test.ts:未登录 → `{ ok: false, errors: { form: "请先登录" } }`;`JoinError` 按 `field` 映射(`code` 错误落 `errors.code`);`TeamPermissionError` → `{ form: "没有权限执行该操作" }`;未知异常 → `console.error` + 通用 form 文案、不泄露内部信息;成功路径透传 data。

- [ ] **Step 2: 运行确认失败**

Run: `pnpm vitest run apps/web/src/features/teams/joins/actions.test.ts`
Expected: FAIL

- [ ] **Step 3: 实现**

"use server" 文件;结构照抄 `features/teams/actions.ts` 的 `toFailure`(增加 JoinError 分支:field → `errors[field]`,field 为 `form` 时落 `errors.form`)。

- [ ] **Step 4: 运行确认通过**

Run: `pnpm vitest run apps/web/src/features/teams/joins`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/features/teams/joins
git commit -m "feat(teams): join-by-code server actions"
```

---

### Task 6: 申请人 UI(/teams/join 页 + /invites 我的申请区块)

**Files:**
- Create: `apps/web/src/app/(dashboard)/teams/join/page.tsx`(RSC)
- Create: `apps/web/src/features/teams/joins/components/JoinByCodeForm.tsx`(client)
- Create: `apps/web/src/features/teams/joins/components/CancelJoinRequestButton.tsx`(client)
- Modify: `apps/web/src/app/(dashboard)/invites/page.tsx`
- Modify: `apps/web/src/app/(dashboard)/teams/new/page.tsx`(页尾互链「已有加入码?凭码加入」)

**Interfaces:**
- Consumes: `createJoinRequestAction` / `cancelJoinRequestAction`(Task 5)、`listMyJoinRequests`(Task 4)、`ConfirmModal`(`components/ui/ConfirmModal.tsx`)、`EmptyState`。

- [ ] **Step 1: 实现 `JoinByCodeForm`**

镜像 `features/teams/components/InviteMemberForm.tsx` 全部结构:antd Form(vertical、requiredMark=false、submitting 禁用);Input `maxLength={8}`、`spellCheck={false}`、placeholder「如 K7M29XQ4」、无 autocomplete;`errors.code` 用 `form.setFields` 落字段,`errors.form` 走顶部 `Alert role="alert"`;成功 `message.success("申请已提交,等待管理员审批")` + resetFields,并渲染指向 `/invites` 的提示链接(antd Typography.Link 或现有 Link 样式)。

- [ ] **Step 2: 实现 `/teams/join/page.tsx`**

RSC:`requireUser()`;`metadata: { title: "凭码加入团队 · Open Doing" }`;页头(标题 + 一句说明「输入团队加入码,提交后由团队管理员审批」)+ `JoinByCodeForm` + 底部一行「不知道加入码?向团队管理员索取,或 创建自己的团队」(Link → `/teams/new`)。样式对照 `teams/new/page.tsx` 的居中窄栏(`max-w-[820px] py-8`)。

- [ ] **Step 3: 实现 `CancelJoinRequestButton`**

client 小件(镜像 `RescindInviteButton`):按钮「取消申请」→ `ConfirmModal`(标题「取消加入申请」、正文含团队名、confirmText「取消申请」、loading 态)→ `cancelJoinRequestAction` → 成功 `message.success` + `router.refresh()`;失败 `message.error(errors.form)`。

- [ ] **Step 4: 扩展 `/invites` 页**

`listMyJoinRequests(user.id)`;在既有「已处理」区块之后渲染「我的加入申请(`N`)」区块:pending 项 = 团队名(链接 `/teams/{slug}`)+ 申请时间(dayjs `MM-DD HH:mm`)+ `CancelJoinRequestButton`;已处理项 = 团队名 + 结果 Tag(approved「已通过」绿 / declined「未通过」灰,复用页内 `RESULT_LABELS` 风格);用户无任何申请时渲染一行占位文案「还没有加入申请,可在 凭码加入团队 页提交」(带链接)。文案与空态落地后回填 V1.1_TASKS §S3。

- [ ] **Step 5: 手工验证 + Commit**

Run: `pnpm dev`,以 seed 用户验证:提交合法/非法/重复码、取消申请、/invites 展示;`pnpm --filter @open-doing/web lint && pnpm --filter @open-doing/web typecheck`。

```bash
git add apps/web/src/app apps/web/src/features/teams/joins
git commit -m "feat(teams): join-by-code applicant UI"
```

---

### Task 7: 审批人 UI(团队设置两个区块)

**Files:**
- Create: `apps/web/src/features/teams/joins/components/JoinCodeSettings.tsx`(client:码展示/复制、重置、开关)
- Create: `apps/web/src/features/teams/joins/components/JoinRequestList.tsx`(client:逐条批准/拒绝)
- Modify: `apps/web/src/app/(dashboard)/teams/[teamSlug]/settings/page.tsx`

**Interfaces:**
- Consumes: `getTeamJoinSettings` / `listTeamJoinRequests`(Task 4)、`respondToJoinRequestAction` / `resetJoinCodeAction` / `setJoinCodeEnabledAction`(Task 5)、`ConfirmModal`、antd `Typography.Text copyable`、`Switch`。

- [ ] **Step 1: 实现 `JoinCodeSettings`**

Props `{ teamId: string; joinCode: string; joinCodeEnabled: boolean }`。布局:`Typography.Text copyable className="font-mono"` 展示码;`Switch` 开关(checked = enabled,onChange 调 `setJoinCodeEnabledAction`,失败 message.error 并回弹);「重置加入码」按钮 → `ConfirmModal`(正文说明旧码立即失效)→ `resetJoinCodeAction` → `router.refresh()`。说明文案:「成员凭此码申请加入,由管理员审批;关闭后无法凭码加入。」

- [ ] **Step 2: 实现 `JoinRequestList`**

Props `{ teamId: string; requests: TeamJoinRequestView[] }`。pending 项 = 头像(`UserAvatar`)+ 用户名 + UID(font-mono)+ 申请时间 + 「通过」(直接调 action)与「拒绝」(ConfirmModal)按钮;loading 态防重复提交;已处理项以 Tag 只读展示(approved/declined + 时间)。空 pending → 「暂无待处理的加入申请」。成功后 `router.refresh()`。

- [ ] **Step 3: 接入 settings 页**

`canManage` 分支内(邀请成员区块之后、成员区块之前)新增两个 section:标题「凭码加入」(渲染 `JoinCodeSettings`)与「加入申请(`N`)」(渲染 `JoinRequestList`);server 侧调 `getTeamJoinSettings(team.id)` + `listTeamJoinRequests(team.id)`。member 视角不渲染两个区块(现状规则:无权限不见入口)。

- [ ] **Step 4: 手工验证 + Commit**

seed 数据:林夏(admin)与周牧(owner)在设置页可见两区块;陈默/苏晓(member)不可见;全流程:member1 凭码申请 → owner 收通知 → 批准 → member1 出现在成员列表且收到通知。

```bash
git add apps/web/src/app apps/web/src/features/teams/joins
git commit -m "feat(teams): join request approval and code management UI"
```

---

### Task 8: SpaceSwitcher 实装(S4)

**Files:**
- Modify: `apps/web/src/components/layout/Sidebar.tsx`(server 侧取数)
- Modify: `apps/web/src/components/layout/SpaceSwitcher.tsx`(client 菜单)
- Test: `apps/web/src/components/layout/SpaceSwitcher.test.ts`

**Interfaces:**
- Consumes: `getCurrentUser`、`listTeamsForUser(userId): Promise<Team[]>`(`features/teams/service`)。
- Produces: 导出纯函数 `selectedSpaceKey(pathname: string, teamSlugs: string[]): string | null` — `/my` 精确命中 → `"personal"`;`/teams/{slug}` 前缀命中(含项目/任务子路径)→ 该 slug;否则 null。菜单结构:分组「个人」→ 个人空间(/my);分组「我的团队」→ 团队列表(/teams/{slug});divider;创建团队(/teams/new)、凭码加入(/teams/join)。

- [ ] **Step 1: 写失败测试**

`SpaceSwitcher.test.ts`(纯函数,node environment):
- `selectedSpaceKey("/my", ["growth"])` → `"personal"`;
- `selectedSpaceKey("/teams/growth", ["growth", "ops"])` → `"growth"`;
- `selectedSpaceKey("/teams/growth/projects/p1/tasks/t1", ["growth", "ops"])` → `"growth"`;
- `selectedSpaceKey("/teams/ops", ["growth"])` → `null`(非我的团队不选中);
- `selectedSpaceKey("/invites", [])` → `null`。

- [ ] **Step 2: 运行确认失败**

Run: `pnpm vitest run apps/web/src/components/layout/SpaceSwitcher.test.ts`
Expected: FAIL

- [ ] **Step 3: 实现**

1. `SpaceSwitcher.tsx`:改为接收 `props: { teams: { slug: string; name: string }[] }`;`usePathname` + `useRouter`;`Dropdown trigger=["click"]` + `selectable` + `selectedKeys={selectedSpaceKey(...) ? [key] : []}`;菜单 onClick → `router.push`;静态硬编码的 items 与「占位交互」注释删除;保留现有触发按钮样式(圆点 + truncate + chevron)与文件头注释(更新为实装说明)。
2. `Sidebar.tsx`:顶部 `const user = await getCurrentUser(); const teams = user ? await listTeamsForUser(user.id) : [];` 传 `<SpaceSwitcher teams={teams.map(t => ({ slug, name }))} />`;文件头注释同步。导入关系不变(F-5 契约不受影响)。

- [ ] **Step 4: 运行确认通过**

Run: `pnpm vitest run apps/web/src/components/layout`
Expected: PASS

- [ ] **Step 5: 手工验证 + Commit**

`pnpm dev`:切换器展示真实团队;点击各项跳转正确;当前团队高亮;`pnpm --filter @open-doing/web lint && typecheck`。

```bash
git add apps/web/src/components/layout
git commit -m "feat(layout): wire space switcher to real navigation"
```

---

### Task 9: 全量门禁 + 任务板收尾

**Files:**
- Modify: `docs/V1.1_TASKS.md`(S2/S3/S4 状态 → ✅)

- [ ] **Step 1: 全量门禁**

Run(需先 source env):`pnpm test && pnpm lint && pnpm typecheck && pnpm build`
Expected: 全绿(typecheck 若报路由类型缺失,先 `pnpm build` 再 typecheck)。

- [ ] **Step 2: 更新任务板并提交**

V1.1_TASKS.md 表格中 S2/S3/S4 状态改 ✅;「已定」如有实现期微调(文案、字段名)回填。

```bash
git add docs/V1.1_TASKS.md
git commit -m "docs(tasks): mark v1.1 S-track complete"
```
