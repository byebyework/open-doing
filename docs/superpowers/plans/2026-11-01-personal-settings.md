# Personal Settings (M6 Zone Setting) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 个人空间设置页 `/space/personal/settings`(修掉 settings 链接 404):改密码 + 临期/逾期提醒开关(作用于 due-scan)+ 个人项目按最近活动排序。

**Architecture:** users 表加两个 boolean 列(迁移可重放);`runDueScan` 投递前按用户偏好过滤;`changePassword` 进 auth 领域(复用 argon2 与注册校验),设置页 RSC + client 包装件消费 Server Actions;`listPersonalProjects` 的 orderBy 改为最近活动子查询。团队设置侧不动(S3 已对齐)。

**Tech Stack:** Next.js 16 App Router(RSC + Server Actions)、Drizzle ORM + PostgreSQL 17、antd v6 + Tailwind 4、Vitest + Playwright。

**Spec:** `docs/V1.1_TASKS.md` §M6(已定 + 本计划);视觉与文案基准 `docs/prototypes/space-settings-personal.html`。

## Global Constraints

- 全站中文;组件以 antd v6 为准,Tailwind 只做布局/微调;不新建 ConfigProvider、不加全局样式覆盖、不用 `<style>` 标签。
- Server Action 契约:`ActionResult<T>`(`{ ok: true, data } | { ok: false, errors: { form?, <field>? } }`),每个 action 独立鉴权(取会话用户),入参校验 → 权限校验 → service。
- 「今天」统一 Asia/Shanghai(`apps/web/src/lib/today.ts` 口径);本计划不引入 per-user 时区。
- 密码规则沿用注册:至少 `PASSWORD_MIN_LENGTH = 8` 位(`features/auth/constants.ts`);argon2 哈希,绝不明文落库。
- 迁移可在空库重放(`apps/web/drizzle/`);`db:generate` 生成后手读 SQL。
- 提醒开关只作用于 `POST /api/cron/due-scan` 的投递;评论/指派/邀请/审批等协作通知不受影响;存量通知不删。
- 测试环境:vitest 与 drizzle-kit 不读 `.env.local`,先 `set -a; source apps/web/.env.local; set +a`;vitest 串行(`fileParallelism: false`),绝不与 e2e 并发;`TEST_DATABASE_URL` 指向的库会被清空。
- typecheck 顺序:先 `pnpm --filter @open-doing/web exec next typegen` 再 `pnpm typecheck`(路由类型由构建生成)。
- git:英文提交信息,结尾 `Co-Authored-By: Claude Code <noreply@anthropic.com>`;不推送。

## Review Focus

1. **提醒开关误伤协作通知**——用户关掉临期提醒后,他人评论/指派他的通知必须照常到达。测试钉:Task 2(cron 只过滤 task_due_soon/task_overdue 两类;领域通知路径不经过 runDueScan,用例断言 cron 过滤后领域动作仍投递)。
2. **改密码后当前会话被登出**——已定要求保持登录(无状态 JWT 不受库内改动影响)。测试钉:Task 3(service 返回成功且不触碰 session;client 包装件成功后不调 logout)。
3. **旧密码错误 / 新密码过短的字段错误映射**——错误必须落在 `oldPassword` / `newPassword` 字段上,不落 `form`。测试钉:Task 3。
4. **最近活动排序的空项目与并列**——没有任何任务的新项目不能被排到最前(无活动时间),并列时要有稳定次序。规则:`COALESCE((SELECT max(tasks.updated_at) …), projects.createdAt) DESC`,并列再按 `createdAt DESC`。测试钉:Task 4。
5. **存量用户开关默认值**——迁移后所有既有用户两个开关必须为 `true`(NOT NULL DEFAULT true,行为不变)。测试钉:Task 1(迁移重放后查询默认值)。

---

### Task 1: users 表提醒开关列 + users service 读写

**Files:**
- Modify: `apps/web/src/server/db/schema.ts`(users 表加两列)
- Modify: `apps/web/drizzle/`(新增迁移,`pnpm db:generate` 生成)
- Modify: `apps/web/src/features/users/service.ts`
- Test: `apps/web/src/features/users/service.test.ts`(新建;沿 `features/analysis/service.test.ts` 的测试库基建写法)

**Interfaces:**
- Consumes: `users` 表(schema)、`DbClient`(`@/server/db/client`)。
- Produces(Task 2/3/5 消费):
  - `export interface ReminderPrefs { dueSoonReminderEnabled: boolean; overdueReminderEnabled: boolean; }`
  - `export async function getReminderPrefs(userId: string, client: DbClient = db): Promise<ReminderPrefs>;`(用户不存在抛错)
  - `export async function updateReminderPrefs(input: { userId: string; dueSoonReminderEnabled?: boolean; overdueReminderEnabled?: boolean }, client: DbClient = db): Promise<ReminderPrefs>;`(部分更新,返回更新后全量)
  - schema 列名:`dueSoonReminderEnabled` / `overdueReminderEnabled`,boolean,`notNull().default(true)`。

- [ ] **Step 1: 写失败测试**——(a) 迁移重放后 `getReminderPrefs` 对新建用户返回 `{ dueSoonReminderEnabled: true, overdueReminderEnabled: true }`(默认值钉);(b) `updateReminderPrefs` 只传一个键时另一个保持不变;(c) 两个键同时更新;(d) `getReminderPrefs` 对不存在 userId 抛错。
- [ ] **Step 2: 跑测试确认失败**——`set -a; source apps/web/.env.local; set +a; pnpm vitest run apps/web/src/features/users`,预期 FAIL(函数不存在)。
- [ ] **Step 3: 加列 + 生成迁移**——schema users 表加两列;`set -a; source apps/web/.env.local; set +a; pnpm db:generate`;手读生成的 SQL:两列均 `DEFAULT true` 且 `NOT NULL`,迁移可对空库与存量库重放。
- [ ] **Step 4: 实现 service**——`ReminderPrefs` 接口 + 两个函数;`getReminderPrefs` 单行 select,查无此人抛 `Error("user not found")` 级别错误(与 users service 现有风格一致)。
- [ ] **Step 5: 跑测试通过**。
- [ ] **Step 6: Commit** — `feat(users): reminder preference columns on users`

### Task 2: due-scan 按用户偏好过滤

**Files:**
- Modify: `apps/web/src/features/notifications/due-scan.ts`
- Test: `apps/web/src/features/notifications/due-scan.test.ts`(追加用例)

**Interfaces:**
- Consumes: Task 1 的 users 两列(`users.dueSoonReminderEnabled` / `users.overdueReminderEnabled`)。
- Produces: `runDueScan(client?, today?)` 签名不变,行为变化:接收人关闭对应开关时,该类型通知不投递(不插入行);另一类型照常。

- [ ] **Step 1: 写失败测试**(沿该文件既有 fixture 风格)——(a) 用户 `overdueReminderEnabled = false`,其逾期任务在扫描后**不产生** `task_overdue` 通知,但同用户临期任务(如有)仍产生 `task_due_soon`;(b) `dueSoonReminderEnabled = false` 对称用例;(c) 对照组:开关全开的用户照常投递;(d) 幂等不受影响:同一扫描跑两遍,插入数第二遍为 0;(e) 领域通知不受影响:在同测试里直接 insert 一条 `task_commented` 型通知(或调用既有领域动作 helper)断言其存在——钉「开关只挡 cron」的边界。
- [ ] **Step 2: 跑测试确认失败**。
- [ ] **Step 3: 实现**——`runDueScan` 的 select `innerJoin(users, eq(tasks.assigneeId, users.id))` 带出两个布尔列,行循环里按 `type` 对应开关为 false 时 `continue`(注释注明:只过滤 cron 投递,协作通知路径不经此处;存量通知不删)。不加 SQL 侧 type 过滤(JS 侧判断即可,保持单查询)。
- [ ] **Step 4: 跑整文件测试通过**。
- [ ] **Step 5: Commit** — `feat(notifications): respect per-user reminder preferences in due scan`

### Task 3: changePassword(auth 领域)

**Files:**
- Modify: `apps/web/src/features/auth/service.ts`(追加函数)
- Modify: `apps/web/src/features/auth/actions.ts`(追加 action)
- Test: `apps/web/src/features/auth/service.test.ts`(追加用例)

**Interfaces:**
- Consumes: `hash`/`verify`(`@node-rs/argon2`)、`PASSWORD_MIN_LENGTH`(`./constants`)、`AuthError`、`DbClient`。
- Produces(Task 5 消费):
  - `export async function changePassword(input: { userId: string; oldPassword: string; newPassword: string }, client: DbClient = db): Promise<true>;`
    - 校验:newPassword 非空且 ≥ `PASSWORD_MIN_LENGTH` 位(错误 `AuthError("VALIDATION", "新密码至少 8 位", "newPassword")`);
    - 旧密码 verify 失败 → `AuthError("INVALID_CREDENTIALS", "旧密码不正确", "oldPassword")`(与 login 同类错误码);
    - 成功:更新 `passwordHash`,返回 true。**不改会话**(无状态 JWT,保持登录)。
  - `export async function changePasswordAction(input: { oldPassword: string; newPassword: string }): Promise<ActionResult<true>>;`(本文件现有 action 均为 pre-auth、无取用户先例——此 action 用 `getCurrentUser()`(`./session`)取会话用户,未登录返回 `{ ok: false, errors: { form: "请先登录" } }`,不走 redirect;`AuthError` → 字段错误映射沿 `toFailure`)

- [ ] **Step 1: 写失败测试**——(a) 正确旧密码 + 合法新密码 → 返回 true,且 `getCredentialsByUsername` 后 `verify` 新密码通过、旧密码失败;(b) 旧密码错误 → 抛 `AuthError`,field `oldPassword`;(c) 新密码 7 位 → field `newPassword`,文案含「至少 8 位」;(d) 新密码为空 → field `newPassword`;(e) 改密后用新密码 login 成功(全链路)。
- [ ] **Step 2: 跑测试确认失败**。
- [ ] **Step 3: 实现** service + action。
- [ ] **Step 4: 跑整文件测试通过**。
- [ ] **Step 5: Commit** — `feat(auth): change password with old-password verification`

### Task 4: 个人项目按最近活动排序

**Files:**
- Modify: `apps/web/src/features/personal/projects/service.ts`(`listPersonalProjects` 的 orderBy)
- Test: `apps/web/src/features/personal/projects/service.test.ts`(追加用例)

**Interfaces:**
- Consumes: `tasks.updatedAt`(既有列)。
- Produces: `listPersonalProjects(userId, client?)` 签名不变;顺序变为:最近活动时间降序——活动时间 = `COALESCE((SELECT max(t.updated_at) FROM tasks t WHERE t.project_id = projects.id), projects.createdAt)`;并列再按 `projects.createdAt DESC`。三个既有调用方(kanban 页 / 项目详情页 / 任务详情页)自动生效。

- [ ] **Step 1: 写失败测试**——fixture 三个个人项目:A 最近有任务更新(今天)、B 无任何任务(createdAt 居中)、C 的任务更新在一周前 → 期望顺序 `[A, B, C]`(B 靠 createdAt 沉到中间,C 最旧);再断言并列稳定性:A 与 C 活动时间相同(构造同秒)时按 createdAt 新者在前。期望值从 fixture 手算,不得引用被测函数输出。
- [ ] **Step 2: 跑测试确认失败**(现状 asc(createdAt) 为 [C, B, A] 类顺序)。
- [ ] **Step 3: 实现**——orderBy 改为上述子查询 + 次序键;保留既有 select 列与返回结构不变。
- [ ] **Step 4: 跑整文件测试通过**。
- [ ] **Step 5: Commit** — `feat(personal): order personal projects by recent activity`

### Task 5: 设置页(组件 + 路由)

**Files:**
- Create: `apps/web/src/features/users/components/ChangePasswordForm.tsx`(`"use client"`)
- Create: `apps/web/src/features/users/components/ReminderToggleList.tsx`(`"use client"`)
- Create: `apps/web/src/app/(dashboard)/space/personal/settings/page.tsx`(RSC)
- Test: 无单测(UI 组合件;行为已由 Task 1–3 service 测试覆盖);类型与构建验证兜底

**Interfaces:**
- Consumes: Task 1 `getReminderPrefs`/`updateReminderPrefs` + Task 1 新增 action `updateReminderPrefsAction(input): Promise<ActionResult<ReminderPrefs>>`(加在 `features/users/actions.ts`,新建该文件,`"use server"`,action 内取会话用户、只允许改本人);Task 3 `changePasswordAction`;`requireUser`(`@/features/auth/session`);原型文案逐字。
- Produces: 路由 `/space/personal/settings`;sidebar 既有 settings 链接(`moduleHref`)随之从 404 变为可用,无导航改动。

- [ ] **Step 1: 实现 `ChangePasswordForm`**——三个 password 输入(旧密码 / 新密码「至少 8 位」/ 确认新密码)+ 提交按钮「更新密码」+ 提示行「更新后保持登录状态;下次登录请使用新密码。」;字段错误映射回对应输入(`oldPassword`/`newPassword`/`form`);前端校验:两次新密码一致、非空;成功 toast「密码已更新」(antd message)并清空表单,**不登出**。antd `Form` + `Input.Password` + `Button`(沿现有 client 表单包装件风格,如 `PersonalProjectFormModal`)。
- [ ] **Step 2: 实现 `ReminderToggleList`**——两行 Switch(临期提醒 / 逾期提醒,文案与副说明照原型逐字);props 传入初始 `ReminderPrefs`;切换即时调 `updateReminderPrefsAction`,失败回滚并 toast「设置保存失败,请稍后重试」;成功静默(不 toast);antd `Switch` + 渲染期同步 props → state 模式(`if (props !== synced) { ... }`)对接 `router.refresh()`。
- [ ] **Step 3: 实现 RSC 页**——`requireUser()` → `getReminderPrefs(user.id)`;页头「设置」+ 副文案照原型;三个区块卡片(账户安全 / 任务提醒 / 项目排序)文案逐字照 `space-settings-personal.html`;项目排序区块为服务端静态说明(无交互),「当前规则」tag 与 callout 照原型。版式 Tailwind 布局 + antd 组件,不做 `<style>`。
- [ ] **Step 4: 验证**——`pnpm --filter @open-doing/web exec next typegen && pnpm typecheck && pnpm lint && pnpm build` 全绿。
- [ ] **Step 5: 手工冒烟**(推荐)——seed 后访问两处:sidebar「设置」链接直达(不再 404);切换开关刷新后保持。
- [ ] **Step 6: Commit** — `feat(settings): personal space settings page`

### Task 6: e2e 流 + §M6 实现记录回填

**Files:**
- Create: `apps/web/e2e/flows/09-personal-settings.spec.ts`
- Modify: `docs/V1.1_TASKS.md`(§M6 追加「实现记录」;顺带把已定中「消费点为 SpaceSwitcher 与个人 dashboard 项目列表」修正为「消费点为 `listPersonalProjects`(个人 Kanban 项目分组等三处调用)」——SpaceSwitcher 只列团队,不列个人项目,计划期核实后的修正)

**Interfaces:**
- Consumes: Task 5 路由;`flows/07`/`flows/08` 的注册/登录 helper(自建新用户,不污染 seed 用户)。
- Produces: e2e 全绿里程碑;文档回填沿 §M5「实现记录」格式。

- [ ] **Step 1: 写 e2e**(沿 `flows/08-space-analysis.spec.ts` 结构;**不得与 vitest 并行跑**)——用例:
  1. 注册新用户 → sidebar「设置」进入 `/space/personal/settings`:三个区块标题(账户安全 / 任务提醒 / 项目排序)可见,两个 Switch 默认开。
  2. 改密码全流程:旧密码错 → 字段错误提示;正确改密 → toast;登出后用旧密码登录失败、新密码成功。
  3. 关闭「临期提醒」→ 刷新页面 Switch 仍为关(持久化)。
  4. 个人 Kanban 建两个项目并对先建者产生任务动态 → 项目顺序为最近活动在前(经 UI 可低成本验证:刷新后顺序变化)。
- [ ] **Step 2: 跑 e2e**——`pnpm --filter @open-doing/web test:e2e -- flows/09-personal-settings.spec.ts`,PASS。
- [ ] **Step 3: 全量验证**——`set -a; source apps/web/.env.local; set +a; pnpm vitest run` → `pnpm --filter @open-doing/web test:e2e` → `pnpm lint && pnpm typecheck && pnpm build`(严格串行)。
- [ ] **Step 4: 回填 §M6 实现记录**——路由契约、三条以上裁定(开关只挡 cron;改密保持登录;排序 COALESCE 规则与并列次序)、service/component/test/e2e 摘要、已知边界(存量通知不删;显示名/头像等「不做」清单沿用已定)。
- [ ] **Step 5: Commit** — `test(e2e): add personal settings flow and finalize M6 docs`

## 执行期裁定预案(控制器按此裁决,不另等待)

- **原型与实现冲突处,以原型文案为准**(M3/M4/M5 先例),偏差逐条记入实现记录。
- **users/actions.ts 是新文件**——users 领域此前无 action;创建它并沿用 auth actions 的 `ActionResult`/错误映射风格,不是例外。
- **`updateReminderPrefsAction` 不建独立权限层**——action 内 `requireUser()` 后强制 `userId = user.id`,只能改本人(与权限模型「每个 action 独立鉴权」一致)。
- **排序子查询不加索引**——个人项目数量级小(v1 个人空间),全表扫描可接受;不为此迁移加索引(YAGNI)。
- **e2e 用例 4 的成本上限**——若经 UI 难以制造可观测的顺序变化,降级为断言「两个项目均出现在 Kanban」并在实现记录注明排序由 service 测试覆盖,不为它造专用 fixture。
