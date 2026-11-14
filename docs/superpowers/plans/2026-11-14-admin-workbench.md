# 管理员工作台实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 建设系统管理员专用的 `/admin` 工作台：概览、注册码管理、用户管理（禁用 / 授权），禁用立即生效。

**Architecture:** `users` 表加 `is_admin` / `is_disabled` / `registration_code_id` 三列并经 better-auth `additionalFields` 进入会话用户；禁用在三处生效（登录钩子拒绝、`getCurrentUser` 清会话、UI 不可达）。新域 `features/admin`（guard / service / actions / components），路由在 `app/admin/` 下独立布局，不复用 `(dashboard)` 的 `AppShell`。

**Tech Stack:** Next.js 16 App Router（RSC + Server Actions）· better-auth（hooks / additionalFields）· Drizzle ORM + PostgreSQL 16 · vendored shadcn/ui + Motion · next-intl（zh/en）

**Spec:** `docs/superpowers/specs/2026-11-14-admin-workbench-design.md`（配套原型 `docs/prototypes/admin/`，页面结构以原型为准）

## Global Constraints

- 每个 Server Action 在函数体内重新校验 `is_admin`，非管理员返回 `standardFailuresForRequest().forbidden()`——不信任 layout/page。
- 所有用户可见文案进 `src/i18n/messages/{zh,en}.json` 双目录，key 结构完全一致（`cjk-guard.test.ts` / `messages-parity.test.ts` 强制）；服务层错误走 `new AdminError(zh fallback, field, { key })` → action 层 `failures.custom("admin.<key>")`。
- 组件只用 vendored shadcn/ui（`src/components/ui/shadcn/`）与项目 composites（`src/components/ui/`：ConfirmModal / EmptyState / StatCard / PageHeader / CARD_SHELL）；颜色用 token CSS 变量；动画走 `motion/react`。
- 页面默认 RSC；交互（弹窗、展开行、搜索框）下沉 `"use client"`；乐观更新用"sync props → state during render"模式对接 `router.refresh()`。
- Drizzle 行类型不跨层，service 查询后在 features 层映射为可序列化 domain model。
- 禁用必须**立即**生效：登录路径钩子拦 `/sign-in/username`（不是 `/sign-in/email`）；会话失效检查放在 `getCurrentUser()`（不是只放 `requireUser()`）。
- 测试串行（`fileParallelism: false`）；数据库测试先 `set -a; source apps/web/.env.local; set +a`，`TEST_DATABASE_URL` 必须指向独立测试库；每文件用 `setupTestDb()` / `closeTestDb()`。
- e2e 跑在 3100 端口 + `open_doing_e2e` 库；**运行前停掉 dev server**（Next 16 同目录锁）；首次需 `pnpm --filter @open-doing/web exec playwright install chromium`。
- Frozen contracts 不动：`(dashboard)/layout.tsx` import 关系、`AppShell`、`docs/prototypes/` 既有文件、`apps/web/src/app/tokens.css`。
- Frozen baseline：`users.registration_code_id` 是可空外键；存量用户为 NULL，UI 显示「未知」；首个管理员由人工 SQL 赋权（写进 seed 文档注释即可，不做自动赋权迁移）。
- git 提交信息用英文（memory 规则），Conventional Commits。

## Review Focus

1. **禁用后 5 秒内的活动会话**：被禁用户正停留在业务页——下一个 Server Action 必须失败（`getCurrentUser` 返回 null → 各 action 的未登录分支），而不是继续可操作到下次刷新。测试钉在 Task 4。
2. **管理员对操作目标的边界输入**：搜索词含 `%` / `_`（`ilike` 通配符）、空搜索、目标 userId 不存在——列表应返回而不是抛错，操作应返回失败而不是 500。测试钉在 Task 5。
3. **注册码并发消费**：两个注册请求同刻用一个只剩 1 名额的码——最多一个成功（原子条件更新既有行为，改动签名后不得退化）。测试钉在 Task 2。
4. **better-auth 适配器对新列的落库**：`registration_code_id` 若未在 `user.create.before` 的返回 data 中被 drizzle adapter 持久化，使用者列表会静默全为「未知」。测试钉在 Task 3（注册后回查该列非 NULL）。
5. **i18n 服务错误回退**：admin service 抛出的错误在 en 请求下必须出英文文案（`failures.custom("admin.<key>")` 按请求语言解析），不能把 zh fallback 直接透出。测试钉在 Task 6。

---

### Task 1: Schema 三列 + User 领域类型扩展

**Files:**
- Modify: `apps/web/src/server/db/schema.ts`（users 表，`language` 字段之后）
- Modify: `apps/web/drizzle/`（`pnpm db:generate` 产出迁移）
- Modify: `packages/types/src/index.ts:42`（`User` 接口）
- Modify: `apps/web/src/features/users/service.ts`（`toDomainUser`）
- Test: `apps/web/src/features/users/service.test.ts`（若已有该文件则追加；否则新建）

**Interfaces:**
- Produces: users 表新列 `is_admin` / `is_disabled`（boolean NOT NULL DEFAULT false）、`registration_code_id`（uuid NULL → registration_codes.id，不设级联删除——注册码永不删除，但为稳妥用 `onDelete: "set null"`）；`User` 领域类型新增必填 `isAdmin: boolean`、`isDisabled: boolean`。

- [ ] **Step 1: 写失败测试（映射 + 默认值）**

```ts
// service.test.ts 追加
describe("toDomainUser admin fields", () => {
  it("maps isAdmin/isDisabled from the row", () => {
    const user = toDomainUser({
      id: "u1", name: "n", createdAt: new Date("2026-01-01"),
      isAdmin: true, isDisabled: true,
    });
    expect(user.isAdmin).toBe(true);
    expect(user.isDisabled).toBe(true);
  });
  it("defaults to false when better-auth omits the fields", () => {
    const user = toDomainUser({ id: "u2", name: "n", createdAt: new Date("2026-01-01") });
    expect(user.isAdmin).toBe(false);
    expect(user.isDisabled).toBe(false);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm vitest run apps/web/src/features/users/service.test.ts`
Expected: FAIL（`isAdmin` 不存在于 User 类型 / toDomainUser）

- [ ] **Step 3: 实现**

`packages/types/src/index.ts` 的 `User` 接口加注释与字段：`isAdmin: boolean`（系统管理员标记）、`isDisabled: boolean`（禁用标记，禁用即拒绝登录）。`toDomainUser` 的入参类型加 `isAdmin?: boolean | null; isDisabled?: boolean | null`，输出 `user.isAdmin ?? false` / `user.isDisabled ?? false`。

`schema.ts` users 表（`language` 之后）加：

```ts
// 管理员工作台（2026-11-14）：is_admin 权限标记；is_disabled 禁用标记（登录被拒 + 会话清除）；
// registration_code_id 记录注册时消费的码，支撑管理台「使用者列表」，存量用户为 NULL。
isAdmin: boolean("is_admin").notNull().default(false),
isDisabled: boolean("is_disabled").notNull().default(false),
registrationCodeId: uuidRef("registration_code_id").references(() => registrationCodes.id, {
  onDelete: "set null",
}),
```

注意：`registrationCodes` 定义在 users 之后，需把该外键挪到文件尾部或用惰性引用方式（与既有 `uuidRef().references()` 写法保持一致；Drizzle 的 `() => registrationCodes.id` 是惰性求值，直接放在 users 定义内即可）。

- [ ] **Step 4: 生成迁移并验证可重放**

Run: `set -a; source apps/web/.env.local; set +a; pnpm db:generate`，检查生成的 SQL 含三列与默认值；然后对测试库重放验证：

Run: `docker compose up -d --wait` 后 `pnpm vitest run apps/web/src/features/users/service.test.ts`
Expected: PASS（测试库走 `setupTestDb()` 重放迁移）

- [ ] **Step 5: 全仓 typecheck 修 fixture**

Run: `pnpm --filter @open-doing/web exec next typegen && pnpm typecheck`
Expected: 所有构造 `User` 字面量的测试 fixture 报缺字段错误——逐个补 `isAdmin: false, isDisabled: false`（或用例语义需要时为 true）。**不要**改为可选字段来规避。

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(admin): add is_admin/is_disabled/registration_code_id columns and domain fields"
```

---

### Task 2: 注册码服务——消费返回码 id + 限额参数化

**Files:**
- Modify: `apps/web/src/features/auth/registration-codes.ts`
- Test: `apps/web/src/features/auth/registration-codes.test.ts`（若已有则追加；没有则新建）

**Interfaces:**
- Produces:
  - `export type RegistrationCodeConsumeResult = { outcome: "ok"; registrationCodeId: string } | { outcome: "invalid" } | { outcome: "exhausted" }`
  - `consumeRegistrationCode(code: string, client?: DbClient): Promise<RegistrationCodeConsumeResult>`（**破坏性签名变更**，Task 3 更新唯一调用方 `hooks.ts`）
  - `generateRegistrationCodes(count: number, client?: DbClient, maxUses?: number): Promise<string[]>`（`maxUses` 默认 `REGISTRATION_CODE_MAX_USES`）

- [ ] **Step 1: 写失败测试**

```ts
describe("consumeRegistrationCode", () => {
  it("returns the code id on success", async () => {
    const [code] = await generateRegistrationCodes(1, db, 5);
    const result = await consumeRegistrationCode(code, db);
    expect(result.outcome).toBe("ok");
    if (result.outcome === "ok") {
      const [row] = await db.select().from(registrationCodes).where(eq(registrationCodes.code, code));
      expect(result.registrationCodeId).toBe(row.id);
    }
  });
  it("never overspends under concurrent consumption of the last slot", async () => {
    const [code] = await generateRegistrationCodes(1, db, 1);
    const results = await Promise.all([consumeRegistrationCode(code, db), consumeRegistrationCode(code, db)]);
    const ok = results.filter((r) => r.outcome === "ok");
    expect(ok).toHaveLength(1);
  });
});
describe("generateRegistrationCodes", () => {
  it("persists a custom maxUses", async () => {
    const [code] = await generateRegistrationCodes(1, db, 25);
    const [row] = await db.select().from(registrationCodes).where(eq(registrationCodes.code, code));
    expect(row.maxUses).toBe(25);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm vitest run apps/web/src/features/auth/registration-codes.test.ts`
Expected: FAIL（类型不匹配 / maxUses 仍为 10）

- [ ] **Step 3: 实现**——`consumeRegistrationCode` 把 `.returning({ id })` 的行带出（rows[0].id 构造 ok 分支）；`generateRegistrationCodes` 的 insert `values({ code, maxUses: maxUses ?? REGISTRATION_CODE_MAX_USES })`。原子条件更新 `WHERE used_count < max_uses` 逻辑不动。

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm vitest run apps/web/src/features/auth/registration-codes.test.ts`
Expected: PASS。同时跑 `pnpm vitest run apps/web/src/features/auth/session.test.ts`——该文件引用了旧签名的 consume（经 hooks），本任务先只修**编译**（把 hooks.ts 的调用点改成匹配新 union、取 `outcome`），行为断言必须仍 PASS。

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "refactor(auth): return code id from consumeRegistrationCode and parameterize maxUses"
```

---

### Task 3: 禁用登录钩子 + 注册写入 registration_code_id

**Files:**
- Modify: `apps/web/src/features/auth/hooks.ts`
- Modify: `apps/web/src/features/auth/auth-error.ts`（ERROR_CODE_MAP）
- Modify: `apps/web/src/features/auth/server.ts`（`user.additionalFields`）
- Modify: `apps/web/src/i18n/messages/zh.json` / `en.json`（`auth.accountDisabled`）
- Test: `apps/web/src/features/auth/hooks.test.ts`（追加；沿用该文件既有的 request mock 模式）

**Interfaces:**
- Consumes: Task 2 的新 `consumeRegistrationCode` union。
- Produces: better-auth 登录路径 `/sign-in/username` 上禁用用户被拒（错误码 `ACCOUNT_DISABLED` → `auth.accountDisabled`）；注册成功用户的 `users.registration_code_id` 非空。`AUTH_ERROR_TOKENS` 新增 `accountDisabled: "ACCOUNT_DISABLED"`。

- [ ] **Step 1: 写失败测试**

```ts
describe("disabled account sign-in", () => {
  it("rejects login for a disabled user via the sign-in/username hook", async () => {
    // 直接库内造一个 is_disabled 用户（不经 UI）：
    const [u] = await db.insert(users).values({ id: randomUUID(), uid: "doing_t1e2s3t4",
      username: "disabled_user", displayUsername: "disabled_user", name: "D",
      email: "disabled@test.local", isDisabled: true }).returning();
    await expect(auth.api.signInUsername({ body: { username: "disabled_user", password: "x" },
      headers: new Headers() })).rejects.toMatchObject({ body: { code: "ACCOUNT_DISABLED" } });
  });
  it("persists registration_code_id at sign-up", async () => {
    // 走 auth.api.signUpEmail 带注册码（沿用 hooks.test 既有注册用例的 body 形状），
    // 断言新用户的 registrationCodeId 等于该码行的 id。
  });
});
```

第二个用例的 body 构造照抄 hooks.test.ts 现有 signUpEmail 用例（用户名/邮箱/密码/registrationCode），只追加最终断言：

```ts
const [row] = await db.select().from(users).where(eq(users.username, "<用例用户名>"));
expect(row.registrationCodeId).toBe(codeRow.id);
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm vitest run apps/web/src/features/auth/hooks.test.ts`
Expected: 第一例 FAIL（登录未被拒）；第二例 FAIL（列 NULL）

- [ ] **Step 3: 实现**

`server.ts` 的 better-auth `user` 配置加 `additionalFields`（三个字段均 `input: false`；`isAdmin`/`isDisabled` `type: "boolean", defaultValue: false`，`registrationCodeId` `type: "string", required: false`）——这是 drizzle adapter 把自定义列带进 `user.create` 写入与会话读取的前提。**若实测 signUpEmail 后 registration_code_id 仍不落库**，退路：改在 `user.create.after` 钩子里用独立 db 连接回写；两条路径取实测可行者，计划预期 primary 路径可通。

`hooks.ts`：
1. `AUTH_ERROR_TOKENS` 加 `accountDisabled: "ACCOUNT_DISABLED"`。
2. `authRequestHooks.before` 增加分支：`ctx.path === "/sign-in/username"` 时读 `ctx.body.username`（string 才查），按 username 查 `users.is_disabled`，命中即 `throw new APIError("BAD_REQUEST", { message: AUTH_ERROR_TOKENS.accountDisabled, code: AUTH_ERROR_TOKENS.accountDisabled })`。注意 username 大小写敏感（`usernameNormalization: false`），查询用精确 eq。
3. `user.create.before` 里把 `consumeRegistrationCode` 的调用改为新 union：`invalid`/`exhausted` 分支照旧抛令牌；`ok` 分支返回 data 时带 `registrationCodeId: consumed.registrationCodeId`。

`auth-error.ts` 的 `ERROR_CODE_MAP` 加：`ACCOUNT_DISABLED: { field: "form", i18nKey: "accountDisabled" }`。

`i18n/messages/zh.json` 的 `auth` 命名空间加 `"accountDisabled": "该账号已被禁用，无法登录；如有疑问请联系管理员"`；`en.json` 加 `"accountDisabled": "This account has been disabled and cannot sign in. Contact an administrator if you believe this is a mistake."`。

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm vitest run apps/web/src/features/auth/` 与 `pnpm --filter @open-doing/web exec next typegen && pnpm typecheck`
Expected: 全 PASS；additionalFields 使 `session.user` 携带三个新字段，`session.test.ts` 若断言 user 形状需同步补字段。

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(auth): reject disabled accounts at sign-in and record registration code usage"
```

---

### Task 4: getCurrentUser 会话清除 + requireAdmin 守卫

**Files:**
- Modify: `apps/web/src/features/auth/session.ts`
- Create: `apps/web/src/features/admin/guard.ts`
- Test: `apps/web/src/features/auth/session.test.ts`（追加）

**Interfaces:**
- Produces:
  - `getCurrentUser()`：会话用户 `isDisabled` 为 true 时删除该用户全部 `sessions` 行并返回 `null`（等效强制下线；无会话者本来返回 null）。
  - `export async function requireAdmin(): Promise<User>`（`features/admin/guard.ts`）：`getCurrentUser()` 为 null → `redirect("/login")`；非管理员 → `redirect("/space/personal/dashboard")`；返回管理员用户。

- [ ] **Step 1: 写失败测试**（沿用 session.test.ts 的 requestState/cookie mock 与 setupTestDb 模式）

```ts
describe("disabled session enforcement", () => {
  it("getCurrentUser clears all sessions and returns null for a disabled user", async () => {
    // 1) 正常登录拿到 cookie（用 loginAction 或 auth.api.signUpEmail 建会话，照抄本文件既有用例）；
    // 2) db.update(users).set({ isDisabled: true }).where(eq(users.id, uid))；
    // 3) requestState.cookieHeader 置为该会话 cookie，调 getCurrentUser() → null；
    // 4) 断言 sessions 表中该 userId 的行数为 0。
  });
  it("returns null when no session cookie is present", async () => {
    requestState.cookieHeader = null;
    await expect(getCurrentUser()).resolves.toBeNull();
  });
});
```

`requireAdmin` 的 redirect 行为用 `vi.mock("next/navigation")` 断言（本文件若已有 redirect mock 则复用；没有则新增，断言 mock 被以 `/space/personal/dashboard` 调用）。

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm vitest run apps/web/src/features/auth/session.test.ts`
Expected: 新增两例 FAIL

- [ ] **Step 3: 实现**

`session.ts` 的 `getCurrentUser`：`toDomainUser` 后检查 `user.isDisabled`，命中则 `await db.delete(sessions).where(eq(sessions.userId, user.id))` 并返回 null（`db` 与 `sessions` 从 `@/server/db/client` / `@/server/db/schema` 引入）。`guard.ts`：

```ts
"use server 布局可调用；redirect 语义见函数注释";
export async function requireAdmin(): Promise<User> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!user.isAdmin) redirect("/space/personal/dashboard");
  return user;
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm vitest run apps/web/src/features/auth/session.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(admin): enforce disabled sessions in getCurrentUser and add requireAdmin guard"
```

---

### Task 5: admin service——概览统计、用户列表/详情、禁用与授权

**Files:**
- Create: `apps/web/src/features/admin/service.ts`
- Test: `apps/web/src/features/admin/service.test.ts`（新建）

**Interfaces:**
- Consumes: Task 1 的 schema 列、Task 4 的 guard 之外直接用 `db`。
- Produces（全部可序列化，Date 一律 `toISOString()` 转字符串）:

```ts
export interface AdminOverviewStats {
  userCount: number; teamCount: number; projectCount: number; taskCount: number;
  regCodeCount: number; regCodeTotalQuota: number; regCodeUsed: number; regCodeRemaining: number;
}
export interface AdminCodeRow {
  code: string; maxUses: number; usedCount: number; createdAt: string;
  usedBy: { id: string; uid: string; username: string; nickname: string | null; createdAt: string }[];
}
export interface AdminUserSummary {
  id: string; uid: string; username: string; nickname: string | null; email: string | null;
  teamCount: number; isAdmin: boolean; isDisabled: boolean; createdAt: string;
}
export interface AdminUserDetail {
  user: AdminUserSummary & { registrationCode: string | null };
  teams: { id: string; name: string; role: "owner" | "admin" | "member"; joinedAt: string }[];
  sessions: { id: string; createdAt: string; ipAddress: string | null; userAgent: string | null }[];
}
export class AdminError extends Error { /* 构造签名对齐各域 Error：new AdminError(zhMessage, field, { key, params? }) */ }
export async function getAdminOverview(client?): Promise<AdminOverviewStats>;
export async function listAdminCodes(client?): Promise<AdminCodeRow[]>;          // 创建时间倒序；usedBy 按注册时间升序
export async function listAdminUsers(query: string | null, client?): Promise<AdminUserSummary[]>; // query 对 username/email/uid 做 ilike，先转义 % _
export async function getAdminUserDetail(userId: string, client?): Promise<AdminUserDetail | null>;
export async function setUserDisabled(targetId: string, disabled: boolean, actorId: string, client?): Promise<void>;  // targetId === actorId 抛 AdminError{key:"selfOperation"}
export async function setUserAdmin(targetId: string, admin: boolean, actorId: string, client?): Promise<void>;        // 同上
```

- [ ] **Step 1: 写失败测试**

```ts
describe("listAdminUsers", () => {
  it("searches by username/email/uid substring, case-insensitive", async () => {
    // 种两个用户（is_admin 一真一假、一禁用一正常、团队数 2/0），断言：
    // query null → 全部；query "HE"（邮箱前缀小写存的场景）命中大小写不敏感；
    // query "doing_" 按 uid 命中。
  });
  it("escapes ilike wildcards in the query", async () => {
    // 用户名不含 %；query "%" → 结果为空数组（字面 % 不匹配任何行），不抛错。
  });
});
describe("setUserDisabled", () => {
  it("toggles the flag", async () => { /* set false→true→false 断言回读 */ });
  it("refuses to operate on self", async () => {
    await expect(setUserDisabled(actorId, true, actorId)).rejects.toMatchObject({
      field: "form", i18n: { key: "selfOperation" },
    });
  });
  it("fails with targetNotFound for an unknown user", async () => {
    // 用随机 uuid 调用 → rejects AdminError{ key: "targetNotFound" }
  });
});
describe("setUserAdmin", () => {
  it("refuses to operate on self", async () => { /* 同上 */ });
});
describe("getAdminOverview / getAdminUserDetail / listAdminCodes", () => {
  // 种 2 用户 / 1 团队(2 成员) / 2 项目 / 4 任务 / 2 码(10 用3、5 用5)，
  // 断言 overview 各计数（regCodeTotalQuota=15, regCodeUsed=8, regCodeRemaining=7, regCodeCount=2）；
  // detail 返回 teams 角色、sessions（造 2 行取 2 行）、registrationCode 码值；
  // listAdminCodes 的 usedBy 含凭码注册的用户且按 createdAt 升序。
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm vitest run apps/web/src/features/admin/service.test.ts`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现**

要点：搜索转义用 `ilike()` + 把 `\`、`%`、`_` 替换为转义形式（Postgres `ILIKE` 默认无转义符，用 `LIKE ... ESCAPE '\'` 或在 drizzle 里 `sql` 模板自定；选一种并在注释说明）；`teamCount` 用 `db.$count` 或对 `team_memberships` 的子查询计数；`setUserDisabled`/`setUserAdmin` 先按 id 查存在性（不存在抛 `targetNotFound`）、再 `targetId === actorId` 抛 `selfOperation`、最后 update 返回行确认。`AdminError` 对齐仓库既有领域 Error 形状（`zhMessage` 必填中文兜底、`field` 默认 `"form"`、`i18n: { key, params }`）——照抄 `features/teams/service.ts` 里的同类 Error 类结构。

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm vitest run apps/web/src/features/admin/service.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(admin): add admin service with overview, user list/detail, disable and grant operations"
```

---

### Task 6: admin Server Actions + i18n admin 命名空间

**Files:**
- Create: `apps/web/src/features/admin/actions.ts`
- Modify: `apps/web/src/i18n/messages/zh.json` / `en.json`（新增顶层 `admin` 命名空间）
- Test: `apps/web/src/features/admin/actions.test.ts`（新建）

**Interfaces:**
- Consumes: Task 2 `generateRegistrationCodes(count, db, maxUses)`；Task 5 service 全部函数；`lib/action-failure` 的 `standardFailuresForRequest()`（`.forbidden()` / `.custom("admin.<key>")`）。
- Produces:

```ts
export async function createRegistrationCodeAction(maxUses: number): Promise<ActionResult<{ code: string }>>;
export async function setUserDisabledAction(targetId: string, disabled: boolean): Promise<ActionResult<true>>;
export async function setUserAdminAction(targetId: string, admin: boolean): Promise<ActionResult<true>>;
```

三个 action 的鉴权模式统一：`const actor = await getCurrentUser(); if (!actor?.isAdmin) return (await standardFailuresForRequest()).forbidden();`——**不用** `requireAdmin()`（它 redirect，action 需要结构化失败）。入参做类型护栏（`maxUses` 取整、限 1–1000；字符串 id 非空），`AdminError` → `failures.custom("admin.<key>")` 落 `error.field ?? "form"`，未知错误 `console.error` 后回 `failures.custom("admin.actionFailed")`。

`admin` 命名空间 zh（en 同 key 结构）：

```json
"admin": {
  "consoleTitle": "管理控制台",
  "navOverview": "概览", "navRegistrationCodes": "注册码管理", "navUsers": "用户管理",
  "backToWorkspace": "返回业务区",
  "overviewTitle": "管理概览", "overviewSubtitle": "系统全量状态一览；数字为实时统计，无缓存。",
  "statUsers": "用户总数", "statUsersDelta": "含 {admin} 名管理员 · {disabled} 个已禁用账号",
  "statTeams": "团队数", "statTeamsDelta": "成员关系 {memberships} 条",
  "statProjects": "项目数", "statProjectsDelta": "个人 {personal} · 团队 {team}",
  "statTasks": "任务数", "statTasksDelta": "当前逾期 {overdue} 个",
  "regCodesCardTitle": "注册码余量", "regCodesManage": "管理注册码",
  "regCodesLowWarning": "{count} 个注册码已耗尽或临近耗尽（剩余 ≤ 2），需要时请新增。",
  "regCodeStatusNormal": "正常", "regCodeStatusExhausted": "已耗尽", "regCodeStatusLow": "临近耗尽",
  "regCodesSummaryTitle": "注册码汇总", "regCodesSummaryCount": "注册码总数", "regCodesSummaryQuota": "总名额",
  "regCodesSummaryUsed": "已使用", "regCodesSummaryRemaining": "剩余名额",
  "regCodesSummaryHint": "剩余名额低于 5 时建议提前补充，注册码一经发出无法停用。",
  "codesTitle": "注册码管理", "codesSubtitle": "封测注册凭码进行；一码多用，固定次数上限，无过期时间。",
  "codesCreate": "新增注册码", "codesCreateTitle": "新增注册码",
  "codesMaxUsesLabel": "次数上限", "codesMaxUsesHint": "该码可被使用的总次数（默认 10）。码值由系统生成，生成后即可分发给新用户。",
  "codesCreateSubmit": "生成注册码", "codesCreateSuccess": "已生成注册码 {code}",
  "colCode": "注册码", "colUsage": "用量", "colUsed": "已用 / 限额", "colCreatedAt": "创建时间", "colUsedBy": "使用者",
  "usedByCount": "{count} 人", "usedByUnknown": "存量用户未回填注册码，显示「未知」。",
  "registeredAt": "{date} 注册",
  "usersTitle": "用户管理",
  "usersSubtitle": "查看账号状态与团队归属；支持禁用 / 解禁与授予管理员。系统不提供删除用户。",
  "usersSearchPlaceholder": "搜索用户名 / 邮箱 / UID…",
  "filterAll": "全部", "filterActive": "正常", "filterDisabled": "已禁用",
  "colUser": "用户", "colEmail": "邮箱", "colTeams": "团队", "colRegisteredAt": "注册时间", "colStatus": "状态", "colActions": "操作",
  "statusActive": "正常", "statusDisabled": "已禁用", "roleAdmin": "管理员", "roleUser": "普通用户",
  "viewUser": "查看",
  "detailBreadcrumbUsers": "用户管理",
  "detailTeamsTitle": "所属团队", "detailSessionsTitle": "最近会话", "detailSessionsHint": "只读展示，供排查「账号异常使用」时参考。",
  "detailAccountTitle": "账号信息", "detailFieldUid": "UID", "detailFieldEmail": "邮箱",
  "detailFieldRegisteredAt": "注册时间", "detailFieldRegCode": "注册码", "detailFieldRegCodeUnknown": "未知",
  "detailFieldStatus": "状态", "detailActionsTitle": "管理操作",
  "grantAdmin": "授予管理员", "revokeAdmin": "撤销管理员",
  "grantAdminTitle": "授予「{name}」管理员身份？",
  "grantAdminBody": "管理员可以进入管理控制台，查看全部用户与注册码，并执行禁用、授权等操作。撤销其管理员身份可随时在本页进行。",
  "grantAdminConfirm": "确认授予",
  "disableTitle": "禁用「{name}」？",
  "disableBody": "该用户的所有会话将被立即删除并强制下线，再次登录会被拒绝。其团队、项目与任务数据保留不动。",
  "disableConfirm": "确认禁用",
  "enableAction": "解禁该用户",
  "enableTitle": "解禁「{name}」？",
  "enableBody": "解禁后该用户可正常登录，此前的会话已失效需要重新登录。",
  "enableConfirm": "确认解禁",
  "disableSuccess": "已禁用 {name}", "enableSuccess": "已解禁 {name}",
  "grantSuccess": "已授予 {name} 管理员", "revokeSuccess": "已撤销 {name} 的管理员",
  "cancel": "取消"
}
```

- [ ] **Step 1: 写失败测试**

```ts
describe("admin actions authorization", () => {
  it("returns forbidden for a non-admin caller on all three actions", async () => {
    // requestState mock 无 cookie 或普通用户 cookie → 三个 action 各断言
    // errors.form 为「没有权限执行该操作」语义（用 messages en/zh 断言或直接非空）。
  });
});
describe("createRegistrationCodeAction", () => {
  it("creates a code with the given maxUses for an admin", async () => {
    // 管理员 cookie（登录一个 is_admin 用户，或库内置 is_admin 后走登录）→
    // ok:true，data.code 存在，库行 maxUses 匹配。
  });
  it("clamps maxUses out of range into a form error", async () => {
    // maxUses 0 / 1001 / NaN → ok:false，errors.maxUses 非空。
  });
});
describe("setUserDisabledAction / setUserAdminAction", () => {
  it("surfaces service AdminError keys as translated form errors", async () => {
    // 管理员操作自己 → errors.form 含「自己」相关文案（断言非空且 ≠ forbidden 文案）。
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm vitest run apps/web/src/features/admin/actions.test.ts`
Expected: FAIL

- [ ] **Step 3: 实现** actions.ts（`"use server"` 顶部声明，模式照抄 `features/auth/actions.ts` 的 try/catch + failures 结构）。

- [ ] **Step 4: 跑测试 + i18n 守卫**

Run: `pnpm vitest run apps/web/src/features/admin/actions.test.ts apps/web/src/i18n/messages-parity.test.ts apps/web/src/i18n/cjk-guard.test.ts`
Expected: 全 PASS（parity 校验 admin ns 双语同构；cjk-guard 校验源码无硬编码 CJK——测试里的断言文案若触发守卫，改用 i18n key 断言或加入白名单并写明理由）

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(admin): add admin server actions and admin i18n namespace"
```

---

### Task 7: /admin 独立布局 + 管理侧栏 + 概览页

**Files:**
- Create: `apps/web/src/app/admin/layout.tsx`
- Create: `apps/web/src/app/admin/page.tsx`
- Create: `apps/web/src/features/admin/components/admin-sidebar.tsx`（RSC，纯导航）
- Create: `apps/web/src/features/admin/components/overview-cards.tsx`（RSC 纯展示）
- Modify: `apps/web/src/i18n/messages/{zh,en}.json`（Task 6 已入 key，此处只消费）

**Interfaces:**
- Consumes: `requireAdmin()`（Task 4）、`getAdminOverview()` / `listAdminCodes()`（Task 5）、`getTranslations()`（next-intl）。
- Produces: `/admin` 布局契约——`layout.tsx` 调 `requireAdmin()`（非管理员不可达页面），渲染独立侧栏（brand + 三模块 nav + 返回业务区 + 管理员徽标用户条）。页面结构与 `docs/prototypes/admin/admin-overview.html` 一致：`PageHeader` + 4 张 `StatCard`（复用 `src/components/ui/` 既有 composite；若其 prop 形状不含 icon-slot，扩展该 composite 而不是自造新卡）+ 「注册码余量」卡（进度条 + 状态徽标，正常/耗尽/临近耗尽阈值：剩余===0 → exhausted；0<剩余≤2 → low）+ 「注册码汇总」卡。**概览页不放任何交互组件**（纯 RSC，无 client wrapper）。余量卡的数字直接来自 `listAdminCodes()`，进度百分比 `usedCount / maxUses`。

- [ ] **Step 1: 实现三文件**（本任务无独立单测——展示组件走 e2e 与 i18n 守卫；`layout.tsx` 的守卫行为已被 Task 4 单测覆盖 redirect 逻辑）

布局：`grid-template-columns: var(--sidebar-width) 1fr` 的独立壳（**不 import** `(dashboard)/layout.tsx`，不触 frozen contract）；侧栏 nav 用 `Link` + `usePathname` 的唯一 client 片段（或用服务端读取路由段的简单方式——倾向 client `AdminNav` 子组件，其余 RSC）。

- [ ] **Step 2: 守卫测试跑一遍**

Run: `pnpm vitest run apps/web/src/features/auth/session.test.ts apps/web/src/i18n/cjk-guard.test.ts apps/web/src/i18n/messages-parity.test.ts`
Expected: PASS

- [ ] **Step 3: 手动验证**

`pnpm dev` 后：普通用户访问 `/admin` 被重定向到 `/space/personal/dashboard`；人工 SQL 置 `is_admin=true` 后可见概览（数字来自种子数据）；`pnpm build && pnpm typecheck` 通过。

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat(admin): add /admin layout, sidebar and overview page"
```

---

### Task 8: 注册码管理页（列表 + 展开 + 新增弹窗）

**Files:**
- Create: `apps/web/src/app/admin/registration-codes/page.tsx`（RSC）
- Create: `apps/web/src/features/admin/components/codes-table.tsx`（client：行展开）
- Create: `apps/web/src/features/admin/components/create-code-dialog.tsx`（client：表单弹窗）
- Test: `apps/web/src/features/admin/create-code-dialog.test.tsx`（新建，表单校验逻辑）

**Interfaces:**
- Consumes: `listAdminCodes()`（Task 5）、`createRegistrationCodeAction`（Task 6）、vendored Dialog 组件（`components/ui/overlay-motion.ts` 的退出保持桥——提交按钮 handler 必须判 `!open || loading` 防双发，与 `ConfirmModal` 同规）。
- Produces: 页面 = `PageHeader`（标题 + 「新增注册码」主按钮）+ `codes-table`（表格：码 `<code>` mono、用量进度条 + 百分比、已用/限额、创建时间、使用者展开钮）。展开行显示 `usedBy` 用户（头像 + 昵称 + uid + 注册时间）；码无使用者显示「未知」说明。弹窗：`maxUses` number input（默认 10，min 1 max 1000），提交成功 → toast（`sonner`，`codesCreateSuccess` 带 code）→ `router.refresh()` → 关闭弹窗（**失败保持打开**，沿用 ConfirmModal 语义）。

- [ ] **Step 1: 写失败测试**（jsdom，测 maxUses 客户端校验与提交 gating）

```tsx
describe("CreateCodeDialog", () => {
  it("submits and calls router.refresh on success", async () => { /* mock action ok → refresh 被调、弹窗关闭 */ });
  it("keeps the dialog open and shows the error on failure", async () => { /* mock action {ok:false} → 不关闭 */ });
  it("gates double submit while loading", async () => { /* loading 中再次点击不再发起 action */ });
});
```

- [ ] **Step 2: 跑测试确认失败** → Run: `pnpm vitest run apps/web/src/features/admin/create-code-dialog.test.tsx` → Expected: FAIL

- [ ] **Step 3: 实现**两组件与页面

- [ ] **Step 4: 跑测试确认通过 + 守卫**

Run: `pnpm vitest run apps/web/src/features/admin/ apps/web/src/i18n/`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(admin): add registration codes page with expandable usage and create dialog"
```

---

### Task 9: 用户列表页（搜索 + 状态筛选）

**Files:**
- Create: `apps/web/src/app/admin/users/page.tsx`（RSC，读 `searchParams`）
- Create: `apps/web/src/features/admin/components/users-table.tsx`（RSC 表格）
- Create: `apps/web/src/features/admin/components/users-filterbar.tsx`（client：搜索框 + ToggleGroup，`router.replace` 写 `?q=` 与 `?status=`）

**Interfaces:**
- Consumes: `listAdminUsers(query)`（Task 5）——`status` 筛选在页面层对结果做内存过滤（全量列表内测量级足够，不做 SQL status 参数，YAGNI）。
- Produces: URL 约定 `?q=<关键词>&status=all|active|disabled`；每行「查看」`Link` → `/admin/users/{id}`。搜索防抖 300ms（client 端 `useTransition` + replace）。

- [ ] **Step 1: 实现**（筛选交互为纯路由状态，单测价值低——由 Task 11 e2e 覆盖搜索与筛选）

- [ ] **Step 2: 验证**

Run: `pnpm vitest run apps/web/src/i18n/ && pnpm --filter @open-doing/web exec next typegen && pnpm typecheck`
Expected: PASS（`searchParams` 的 Promise 形态按 Next 16 类型）

- [ ] **Step 3: 手动验证**：搜索 `林`、点「已禁用」筛选、清空搜索——URL 与列表同步。

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat(admin): add users list page with search and status filter"
```

---

### Task 10: 用户详情页（账号信息 + 团队 + 会话 + 禁用/授权操作）

**Files:**
- Create: `apps/web/src/app/admin/users/[userId]/page.tsx`（RSC，`notFound()` 兜底未知 id）
- Create: `apps/web/src/features/admin/components/user-actions.tsx`（client：授予/撤销管理员、禁用/解禁，ConfirmModal 包裹）
- Create: `apps/web/src/features/admin/components/detail-cards.tsx`（RSC：团队、会话、账号信息）

**Interfaces:**
- Consumes: `getAdminUserDetail(userId)`（Task 5）、`setUserDisabledAction` / `setUserAdminAction`（Task 6）、`ConfirmModal`（确认失败保持打开、loading 禁 Esc；**消费者在成功分支里自己关闭**）。
- Produces: 详情页右侧「管理操作」卡——目标是普通用户时显示「授予管理员」(primary outline) + 「禁用该用户」(destructive)；目标已是管理员显示「撤销管理员」；目标已禁用显示「解禁该用户」。操作成功 → `sonner` toast（对应 `*Success` key）→ `router.refresh()` → 关闭弹窗。**页面 RSC 层必须隐藏当前登录管理员对自己的 destructive 操作**（`requireAdmin()` 的返回值与 detail.user.id 比对），服务层 selfOperation 校验仍是兜底。

- [ ] **Step 1: 实现三文件**

- [ ] **Step 2: 验证**

Run: `pnpm vitest run apps/web/src/i18n/ && pnpm typecheck`
Expected: PASS

- [ ] **Step 3: 手动验证**：禁用 → 业务区用户被踢回登录页且无法登录（zh/en 各验一次错误文案）；解禁恢复；授予/撤销管理员后侧栏用户徽标变化。

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat(admin): add user detail page with disable and grant-admin actions"
```

---

### Task 11: e2e smoke flow——管理员全链路

**Files:**
- Create: `apps/web/e2e/flows/06-admin-workbench.spec.ts`
- Modify: `apps/web/e2e/global-setup.ts`（如需追加种子；预期不需要——管理员经 UI 注册后 SQL 翻位）

**Interfaces:**
- Consumes: 既有 flows 的注册/登录 helper（`e2e/flows/` 与 `e2e/utils/` 现有模式，`E2E_REGISTRATION_CODE`）；Playwright 端口 3100。
- Produces: 覆盖 Review Focus 1/4 的端到端证据。

- [ ] **Step 1: 写 spec**（断言选择器用 data-testid / role，不依赖文案语言）

```ts
// 流程（两个独立注册的 e2e 用户 admin-user / victim-user）：
// 1. admin-user 经 UI 注册 → SQL 翻 is_admin=true（用 e2e 库直连，参照 global-setup 的客户端构造）→ 重新登录；
// 2. /admin 概览可见（等待统计卡出现）；
// 3. 注册码页：新增注册码（maxUses=3）→ 列表出现新码行 → 展开使用者显示 admin-user 自己（Review Focus 4）；
// 4. victim-user 在另一 context 登录并停留在 dashboard（保持会话活跃）；
// 5. admin-user 打开 victim-user 详情 → 禁用（ConfirmModal）→ toast；
// 6. victim-user context 里发起任一 Server Action（如刷新后点击任一业务操作）→ 被拒回 /login；尝试登录 → 登录表单错误出现（Review Focus 1）；
// 7. admin-user 解禁 victim-user → victim-user 重新登录成功。
```

- [ ] **Step 2: 停 dev server 后跑 e2e**

Run: 确认 `pnpm dev` 已停止；`pnpm --filter @open-doing/web test:e2e -- flows/06-admin-workbench.spec.ts`
Expected: PASS

- [ ] **Step 3: 全量回归**

Run: `pnpm lint && pnpm test && pnpm build && pnpm typecheck`
Expected: 全 PASS

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "test(e2e): add admin workbench smoke flow"
```

---

## 交付前检查清单（收尾任务）

- [ ] `pnpm lint && pnpm test && pnpm build && pnpm typecheck` 全绿（typecheck 在 typegen 之后）
- [ ] e2e：`flows/06-admin-workbench.spec.ts` + 至少跑一条既有 flow 确认无回归
- [ ] cjk-guard / messages-parity 全绿；zh/en 的 `admin` 与 `auth.accountDisabled` 双语齐全
- [ ] 冻结契约未动：`git diff main --stat` 中不出现 `(dashboard)/layout.tsx`、`AppShell`、`docs/prototypes/` 既有文件、`tokens.css`
- [ ] 在仓库文档（`AGENTS.md` 的 seed 一节或 README）记一笔：首个管理员由人工 SQL `UPDATE users SET is_admin = true WHERE uid = '...'` 赋权
