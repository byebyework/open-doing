# better-auth 认证切换(阶段 B)实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 用 better-auth 1.7 替换自研认证(jose JWT + 自写注册/登录/改密),注册时邮箱从可选改为必填,注册码封测机制语义保留。

**Architecture:** `users` 表同时充当 better-auth 的 user 模型(扩展列),新增 sessions/accounts/verifications 三表;`features/auth/server.ts` 定义唯一 better-auth 实例;`requireUser()`/`getCurrentUser()` 签名不变,内部改走 `auth.api.getSession`;注册码消费与 uid 生成进 `databaseHooks.user.create.before`。

**Tech Stack:** better-auth ^1.7.18(drizzle adapter、username 插件、nextCookies 插件)/ PostgreSQL 16 / Next.js 16 Server Actions。

**Spec:** `docs/superpowers/specs/2026-11-09-postgres-better-auth-design.md` §阶段 B(阶段 A 已落地:PG 16 @5433、pg-core schema、postgres-js)。

## Global Constraints

- 冻结契约不碰:`AppShell`、`(dashboard)/layout.tsx` 导入关系;所有 Server Action 独立鉴权逻辑不动。
- i18n:全部用户可见文案进 zh/en 消息目录(`cjk-guard` / `messages-parity` 测试必须过);better-auth 报错在 action 层映射翻译,绝不把英文原始报错透给 UI。
- 登录失败统一文案(不泄露用户名存在性);密码最小 8 位(`PASSWORD_MIN_LENGTH`);用户名 2–20 字符、大小写敏感(`USERNAME_MIN_LENGTH/MAX`)。
- 会话 30 天(`session.expiresIn: 60*60*24*30`);改密后吊销其他会话(`revokeOtherSessions: true`,已确认的行为变更)。
- 环境变量:`BETTER_AUTH_SECRET`(替代 `SESSION_SECRET`;dev 缺省回退固定开发值、生产缺失显式报错)、`BETTER_AUTH_URL`(可选,baseURL)。
- better-auth 事实(已核实,写死用):核心四表 = user(id, name, email UQ, emailVerified, image?, createdAt, updatedAt)/ session(id, userId, token UQ, expiresAt, ipAddress?, userAgent?, createdAt, updatedAt)/ account(id, userId, accountId, providerId, accessToken?, refreshToken?, accessTokenExpiresAt?, refreshTokenExpiresAt?, scope?, idToken?, password?, createdAt, updatedAt)/ verification(id, identifier, value, expiresAt, createdAt, updatedAt);username 插件经 `usernameNormalization: false` 关闭小写归一;Server Action 中由 `nextCookies()` 插件(better-auth/next-js,**必须放在 plugins 数组最后**)自动落 Set-Cookie;RSC/Action 读会话用 `auth.api.getSession({ headers: await headers() })`。
- 环境注意:vitest/drizzle-kit 前 `set -a; source apps/web/.env.local; set +a`;e2e 前停 dev server(`lsof -ti:3000`)、跑完重启(`cd apps/web && nohup pnpm dev > /tmp/open-doing-dev.log 2>&1 &`)。
- 提交:Conventional Commits 英文,结尾 `Co-Authored-By: Claude Code <noreply@anthropic.com>`。

## Review Focus

1. **注册码原子性**:`databaseHooks.user.create.before` 消费注册码后若注册仍失败(如唯一冲突),名额是否被白耗取决于 better-auth 事务包裹——**Task 2 的 spike 必须实测并把结论写进代码注释**;测试钉住"注册码无效/已用尽/成功消费"三态。
2. **用户名大小写敏感**:`Alice` 与 `alice` 必须可并存(`usernameNormalization: false` 生效)。→ Task 2 测试。
3. **错误文案不漏英文**:better-auth/APIError 的所有已知错误码在 action 层有映射,未知错误落 `auth.*Failed` 兜底。→ Task 2/3 映射表测试 + cjk-guard。
4. **改密吊销其他会话**:改密后旧会话 cookie 立即失效。→ Task 3 测试(两个会话,改密,旧会话 getSession 返回 null)。
5. **守卫行为不变**:未登录访问受保护路由重定向 `/login`;`getCurrentUser` 按请求缓存(同请求多次调用只查一次库)。→ Task 3 测试 + 既有 e2e。

---

### Task 1: better-auth 依赖、schema 扩展与 auth 实例

**Files:**
- Modify: `apps/web/package.json`(+`better-auth`;`jose`/`@node-rs/argon2` 本任务**不删**,Task 3 删)
- Modify: `apps/web/src/server/db/schema.ts`(users 扩展 + 3 新表)
- Modify: `apps/web/src/server/db/testing.ts`、`apps/web/e2e/global-setup.ts`(TRUNCATE 清单 +sessions/accounts/verifications)
- Modify: `apps/web/src/server/db/seed.ts`(seed 用户补 email/name)
- Create: `apps/web/src/features/auth/server.ts`
- Modify: `apps/web/.env.example`(BETTER_AUTH_SECRET / BETTER_AUTH_URL)
- Regenerate: `apps/web/drizzle/*`(单一 0000 init)
- Test: `apps/web/src/server/db/schema.test.ts`(新表/新列断言)

**Interfaces:**
- Produces(Task 2/3 依赖):
  - `auth`(export 自 `features/auth/server.ts`):betterAuth 实例。
  - schema 导出:`users`(扩展)、`sessions`、`accounts`、`verifications`。
  - `getSessionSecret()`(移入 `features/auth/server.ts` 或保留 `lib/`,读 `BETTER_AUTH_SECRET`,dev 回退 `open-doing-dev-only-session-secret`,生产缺失 throw)。

- [ ] **Step 1: schema.test 先行(失败)**

新增断言:users 有 `name`(notNull text)、`emailVerified`(boolean notNull default false)、`image`(nullable)、`displayUsername`(notNull)、`updatedAt`(timestamptz notNull);email now `notNull()`;`passwordHash`/`nickname` 不存在;sessions/accounts/verifications 三表存在且 session.token 唯一。Run `pnpm vitest run apps/web/src/server/db/schema.test.ts` → FAIL。

- [ ] **Step 2: 改 schema.ts**

users 表(列名 snake_case 不变,TS 属性名 = better-auth 字段名):加 `name: text("name").notNull()`、`emailVerified: boolean("email_verified").notNull().default(false)`、`image: text("image")`、`displayUsername: text("display_username").notNull()`、`updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()`;`email` 加 `.notNull()`;删 `passwordHash`、`nickname` 列。新表:`sessions`(id uuid pk defaultRandom、userId uuid notNull references users.id onDelete cascade、token text notNull unique、expiresAt timestamptz notNull、ipAddress text、userAgent text、createdAt/updatedAt timestamptz notNull defaultNow,索引 `sessions_user_id_idx` on userId)、`accounts`(同族字段含 password text nullable,索引 `accounts_user_id_idx`)、`verifications`(id、identifier text notNull、value text notNull、expiresAt timestamptz notNull、createdAt/updatedAt,索引 `verifications_identifier_idx`)。

- [ ] **Step 3: 重建迁移并重置 dev 库**

```bash
rm -rf apps/web/drizzle && set -a; source apps/web/.env.local; set +a
pnpm db:generate && docker compose exec postgres psql -U open-doing -d open_doing -c 'DROP SCHEMA public CASCADE; CREATE SCHEMA public;' && pnpm db:migrate && pnpm db:seed
```
Expected: 单一 `0000_*` 含全部 14 表;seed 成功。

- [ ] **Step 4: seed.ts 适配**

每个 seed 用户:`name` = 原 nickname 逻辑、`email` 唯一(如 `<username>@example.com`,小写)、`emailVerified: false`、`displayUsername` = username;删 passwordHash/nickname 字段引用。

- [ ] **Step 5: TRUNCATE 清单 +3 表**(testing.ts 与 e2e global-setup 逐表同步)。

- [ ] **Step 6: 写 auth 实例 `features/auth/server.ts`**

```ts
export const auth = betterAuth({
  secret: getSessionSecret(), baseURL: process.env.BETTER_AUTH_URL,
  database: drizzleAdapter(db, { provider: "pg", schema: { user: users, session: sessions, account: accounts, verification: verifications } }),
  emailAndPassword: { enabled: true, minPasswordLength: 8 },
  session: { expiresIn: 60 * 60 * 24 * 30 },
  user: { additionalFields: {
    uid:   { type: "string", required: false, input: false },
    gender: { type: "string", required: false, input: true },
    phone: { type: "string", required: false, input: true },
    language: { type: "string", required: false, input: false, defaultValue: "zh" },
    dueSoonReminderEnabled: { type: "boolean", required: false, input: false, defaultValue: true },
    overdueReminderEnabled: { type: "boolean", required: false, input: false, defaultValue: true },
  } },
  plugins: [username({ usernameNormalization: false, minUsernameLength: 2, maxUsernameLength: 20 }), nextCookies()],
});
```
(字段 defaultValue/类型以安装后的类型定义为准修正;`nextCookies` 必须最后。)

- [ ] **Step 7: schema.test 通过 + 新文件 lint/typecheck 干净;Commit**

`feat(auth): add better-auth schema tables and auth instance`

---

### Task 2: 注册链路(signUpUsername + 注册码/uid hooks + 错误映射)

**Files:**
- Modify: `apps/web/src/features/auth/service.ts`(收窄为校验/归一化 + 常量)、`features/auth/actions.ts`(registerAction 重写)
- Create: `apps/web/src/features/auth/hooks.ts`(databaseHooks:注册码消费 + uid/name 兜底,挂进 server.ts)
- Test: `apps/web/src/features/auth/service.test.ts`(重写)、`apps/web/src/features/auth/registration-codes.test.ts`(保留)

**Interfaces:**
- Consumes: Task 1 的 `auth`、schema 导出、`consumeRegistrationCode(code, tx)`(现有,原子条件扣减)、`generateUid()`、`generateNickname(uid)`。
- Produces(Task 3 依赖):
  - `registerAction(input: AuthInput): Promise<ActionResult<User>>`(签名不变;`AuthInput.email` 语义变必填)。
  - `auth-error.ts`(Create:`mapAuthError(error): Promise<{ field, i18nKey } | null>` — better-auth 错误码映射表,Task 3 复用)。
  - `normalizeRegistrationCode` / 校验常量照旧。

- [ ] **Step 1: Spike(一次脚本/临时测试,结论写进 hooks.ts 注释)**

对测试库实测两点:(a) `auth.api.signUpUsername` 是否把 user+account 写入包在同一事务、`databaseHooks.user.create.before` 内抛错是否整体回滚且不落用户;(b) hook 的第二参数 ctx 能否读到 `ctx.body.registrationCode`(server.ts 的 `hooks.before` 校验注册码存在后,把码挂到 body 传入)。若 (b) 不通,fallback:模块级 `AsyncLocalStorage` 在 hooks.before 存、databaseHooks 取。两条结论各一行注释 + 报告记录。

- [ ] **Step 2: 重写 service.test 注册用例(失败)**

保留/改造的用例名与断言:注册成功返回 User(email 必填、gender/phone 落库、language 默认 "zh"、name = nickname || `user_<hash5>`、uid 生成、displayUsername = username);注册码无效→ `registrationCode` 字段错;已用尽→同字段;用户名已存在→ `usernameTaken`;邮箱已存在→ `emailTaken`;`Alice` 后注册 `alice` 成功(大小写敏感);邮箱大小写归一(`A@B.com` 存为 `a@b.com`);uid 碰撞中止注册(通用错误)。Run → FAIL。

- [ ] **Step 3: 实现注册链路**

`hooks.before`(定义在 hooks.ts,随 databaseHooks 一起挂进 server.ts;仅 sign-up 路径):校验注册码格式/存在性,失败抛 `APIError("BAD_REQUEST", { message: REG_CODE_INVALID })`;`databaseHooks.user.create.before`:生成 uid(`generateUid()`,撞 `users_uid_unique` 抛 `APIError(... UID_COLLISION)`)、兜底 `name`(空则 `generateNickname(uid)`)、`displayUsername` 空则取 username、原子消费注册码(invalid/exhausted 抛对应 APIError)。`registerAction`:我们的前置校验(email 必填/格式、nickname ≤50、gender 枚举 — 复用现有 validate 逻辑)→ `auth.api.signUpUsername({ body: { username, password, email, name, gender?, phone?, registrationCode } })` → 失败经 `mapAuthError` 映射。`mapAuthError` 初版映射(以安装包实际错误码枚举补全):`USERNAME_IS_ALREADY_TAKEN`→username/`usernameTaken`;`USER_ALREADY_EXISTS`→email/`emailTaken`;`INVALID_USERNAME_OR_PASSWORD`→form/`invalidCredentials`;`PASSWORD_TOO_SHORT`→password/`passwordMinLength`;`REG_CODE_*`/`UID_COLLISION`→registrationCode|form 对应 key;未知→null(兜底 `registerFailed`)。

- [ ] **Step 4: 测试通过(含 registration-codes.test 回归);Commit**

`feat(auth): register via better-auth with registration-code hook`

---

### Task 3: 会话接线 + 登录/登出/改密(删 jose)

**Files:**
- Rewrite: `apps/web/src/features/auth/session.ts`(jose → `auth.api.getSession`)
- Modify: `apps/web/src/features/auth/actions.ts`(login/logout/changePassword)、`features/auth/service.ts`(删 login/registerUser/changePassword 旧实现)、`features/users/service.ts`(toUser 映射 name→nickname;删 `getCredentialsByUsername`/`usernameExists` 若不再被引用)、`features/users/actions.ts` 及昵称更新路径(nickname 写入改 name 列)、`apps/web/src/features/users/` 下语言/提醒偏好读写(确认列名未变即无需改)
- Modify: `apps/web/package.json`(删 `jose`、`@node-rs/argon2`)
- Test: `apps/web/src/features/auth/session.test.ts`(重写)

**Interfaces:**
- Consumes: Task 1 `auth`、Task 2 `mapAuthError`。
- Produces: `getCurrentUser(): Promise<User | null>`、`requireUser(): Promise<User>`、`SESSION_COOKIE_NAME`/`SESSION_COOKIE_OPTIONS`/`signSessionToken`/`verifySessionToken`/`createSession`/`clearSession`/`getSessionUserId`/`getSessionSecret` **全部删除**(grep 确认无引用残留);`toUser(row)` 适配新行(name→nickname)。

- [ ] **Step 1: 重写 session.test(失败)**

用例:登录后 `getCurrentUser` 返回完整 domain User(nickname 来自 name、uid/language 在);无 cookie → null;伪造/过期 cookie → null(不再是签名校验,而是 session 表无对应行);改密后其他会话失效(两个 session,`changePasswordAction` 带 `revokeOtherSessions: true`,旧 session `getCurrentUser` → null);`requireUser` 未登录 redirect `/login`。Run → FAIL。

- [ ] **Step 2: 实现会话与三个 action**

`getCurrentUser = cache(async () => { const res = await auth.api.getSession({ headers: await headers() }); return res ? toDomainUser(res.user) : null; })`;`requireUser` 逻辑不变。`loginAction` → `auth.api.signInUsername({ body: { username, password } })`(失败经 `mapAuthError`,统一 `invalidCredentials`);`changePasswordAction` → `auth.api.changePassword({ body: { currentPassword, newPassword, revokeOtherSessions: true }, headers })`(旧密码错 → `oldPassword` 字段);`logoutAction` → `auth.api.signOut({ headers })`。`toDomainUser` 放 `users/service.ts` 复用 toUser 的映射(nickname = name)。domain `User` 类型(`packages/types`)不动:nickname 语义由 name 承载。

- [ ] **Step 3: 依赖清理 + 全仓 grep**

`grep -rn "jose\|argon2\|SESSION_COOKIE\|SESSION_SECRET\|signSessionToken" apps/web/src apps/web/e2e` → 仅历史文档;`pnpm install` 更新 lockfile。

- [ ] **Step 4: 测试通过 + `pnpm test` 全量;Commit**

`feat(auth): wire sessions and login flows to better-auth`

---

### Task 4: 注册表单邮箱必填 + 消息目录

**Files:**
- Modify: `apps/web/src/features/auth/components/RegisterForm.tsx`(email 必填校验)
- Modify: `apps/web/src/i18n/messages/zh.json`、`en.json`(`auth` ns:新增/调整 emailRequired 等 key;emailOptional 相关文案若存在则改)
- Test: `apps/web/src/features/auth/components/RegisterForm.test.tsx`

- [ ] **Step 1: 表单测试先行(失败)**:空 email 提交 → `email` 字段显示 required 文案;填 email 后提交正常。
- [ ] **Step 2: 改表单 + zh/en 目录同步**;`messages-parity` / `cjk-guard` 通过。
- [ ] **Step 3: Commit** — `feat(auth): require email at registration`

---

### Task 5: e2e 适配 + 文档 + 终验

**Files:**
- Modify: `apps/web/e2e/flows/`(注册 flow 补 email 输入;登录/登出/改密/设置 flow 适配;新增或扩展:改密后旧会话失效断言可按现有 flow 结构做简版)
- Modify: `AGENTS.md`、`docs/ARCHITECTURE.md`(认证段落:自研 jose → better-auth;users 表新形状;邮箱必填;DB 会话)、`apps/web/e2e/utils/env.ts`(SESSION_SECRET → BETTER_AUTH_SECRET,e2e 值名同步)
- Sweep: `grep -rn "SESSION_SECRET" apps/web docs .env.example` → 清零

- [ ] **Step 1: e2e 流程适配并逐条跑**(停 dev server → 跑 → 重启)。
- [ ] **Step 2: 文档同步 + 残留清扫**。
- [ ] **Step 3: 终验**:`pnpm lint && pnpm typecheck && pnpm test && pnpm --filter @open-doing/web test:e2e` 全绿。
- [ ] **Step 4: Commit** — `docs(auth): sync guides to better-auth stack`(e2e 归 `test(e2e): adapt flows to better-auth registration`)。

## 留给实现计划的裁量

- better-auth 安装后以 `node_modules/better-auth` 类型为准校正 additionalFields/插件选项的确切类型;错误码全集从包内枚举,映射表须覆盖 signUpUsername/signInUsername/changePassword 能抛的全部用户可见码。
- spike 两项结论(Task 2)必须落注释与报告;若事务不包裹,残余风险(名额白耗)按 spec 接受并注释。
- 逐文件测试 fixture 的调整粒度。
