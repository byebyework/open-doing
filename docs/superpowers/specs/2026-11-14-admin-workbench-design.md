# 管理员工作台（Admin Workbench）设计

日期：2026-11-14
来源：封测运营痛点——注册码每次都要直连数据库新增；用户不可见、不可管。立项一个系统管理员专用的后台工作台。

## Intent / Why

系统目前没有管理员概念：注册码靠手动操作数据库新增，用户（封测账号）出了问题既看不到也管不了。本设计给**系统管理员**（运营本系统的人）一个凌驾于所有 Space 之上的管理区域：看系统状态、管注册码、管用户。封测规模下从简：一个布尔标记就是全部权限体系，UI 偏功能向（表格 + 表单 + 操作按钮），不按业务原型精雕。

## Goals / Non-goals / Anti-goals

**Goals（第一期范围，三个模块）**

1. **概览页**：关键数字一眼看全——总用户数、团队数、项目数、任务数，外加注册码余量（总剩余名额 / 即将耗尽的码）。RSC 每次进页面现查，不做缓存刷新机制。
2. **注册码管理**：
   - 新增：生成一个新码（沿用现有 8 位 / 31 字符集生成逻辑）、指定 `max_uses`；
   - 列表：码、限额、已用次数、剩余、创建时间、**使用者列表**（哪些用户凭此码注册）。
3. **用户管理**：
   - 列表 + 搜索（按用户名 / 邮箱 / uid）；
   - 详情：基本信息（uid、用户名、展示名、邮箱、注册时间）、所属团队、最近会话；
   - **禁用 / 解禁**开关（ConfirmModal 确认，防误触）；
   - **授予 / 撤销管理员**（ConfirmModal 确认）。

**Non-goals（明确不做，留给以后）**

- 不做删除用户（外键级联删号的风险面太大，永远走人工数据库操作）。
- 不做用户内容巡检 / 编辑（不查看、不修改任何人的任务与项目内容）。
- 不做团队治理（团队列表可以有、用于概览计数与用户详情展示，但不提供干预操作）。
- 不做邀请 / 加入申请仲裁。
- 不做角色细分（管理员 / 运营 / 只读审计员等）。
- 不做注册码停用、删除、编辑限额（第一期只有新增 + 列表）。
- 不做操作审计日志。

**Anti-goals（失败形态）**

- 把 `/admin` 混进业务 Space 导航或复用 `AppShell`（冻结契约，且入口必须独立）。
- 权限判断只藏在页面层（UI 隐藏入口 ≠ 访问控制——每个 Server Action 必须独立鉴权）。
- 禁用依赖定时任务生效（禁用必须立即拒绝登录、立即让现有会话失效）。
- 引入 antd 或绕开 vendored shadcn/ui 自造组件。

## 用户已拍板的决策

- **使用者**：系统管理员（运营者本人/团队），不是团队管理员。
- **权限载体**：`users` 表加 `is_admin` 布尔字段（不做 uid 硬编码白名单）。
- **第一期范围**：概览 + 注册码（新增/列表）+ 用户（看/禁用/**授予撤销管理员**）；注册码现阶段只做新增，停用后补。
- **用户操作**：看、禁用、授予/撤销管理员，明确不做删除。
- **管理员互管**：允许——管理员可以禁用 / 撤权其他管理员，**自我保护（不能操作自己）是唯一的防呆规则**。

## 约束（引自 AGENTS.md，逐条对任务生效）

- 每个 Server Action 独立鉴权；数据查询带可见性过滤（admin 域的过滤条件就是 `is_admin`）。
- 所有 UI 文案进 `src/i18n/messages/{zh,en}.json`（cjk-guard + messages-parity 强制）；服务层错误走 `Error(zh fallback, field, { key })` → `toFailure` → `errors` / `admin` 命名空间。
- 组件用 vendored shadcn/ui + 项目级 composites（`src/components/ui/`），Tailwind 只做布局微调；token CSS 变量，不写字面量 hex。
- 所有 UI 动画走 Motion；overlay 退出期注意 `!open || loading` 双发防护。
- Frozen contracts（`AppShell`、`(dashboard)/layout.tsx` import 关系）不动。
- 日期语义：RSC 传 `today`（Asia/Shanghai），组件内不取本地时区。
- TDD；vitest 串行、测试库独立于开发库；e2e 前停 dev server。
- 写 Next 相关代码前查阅 `apps/web/node_modules/next/dist/docs/` 对应指南。

## 各项设计

### 1. 数据模型

`users` 表新增两列（一个迁移）：

- `is_admin: boolean NOT NULL DEFAULT false` —— 权限标记。
- `is_disabled: boolean NOT NULL DEFAULT false` —— 禁用标记（禁用语义见 §3）。
- `registration_code_id: uuid NULL REFERENCES registration_codes(id)` —— 注册时消费的码，支撑"使用者列表"。存量用户为 NULL（= 历史不明，列表里如实显示"未知"）；注册钩子（`features/auth/hooks.ts` database hook）在消费注册码成功后一并写入。此列为我的决定：`registration_codes` 本身不记录使用者，加可空外键是改动最小的方案。

实现陷阱（审阅核验发现，计划必须落实）：
- `consumeRegistrationCode` 现返回 `"ok" | "invalid" | "exhausted"`，不返回码的 id——内部已有 `.returning({ id })`，小改签名即可把码 id 带出来供钩子写入。
- better-auth 的 drizzle adapter 在 `user.create.before` 里持久化自定义列，很可能要求先在 `features/auth/server.ts` 的 `user.additionalFields` 里声明 `registration_code_id`（`input: false`）；若声明后仍不落库，退路是改用 `user.create.after` 钩子写库。计划里两条路径都要预研，取实测可行者。
- `generateRegistrationCodes`（`features/auth/registration-codes.ts` 一带 / `apps/web/src/server/db/register-codes.ts`）目前把 `max_uses` 硬编码为 10，管理台新增表单需要把它参数化。旧的手动脚本 `pnpm register-codes` 保留不动（无冲突，仅被本工作台取代使用场景）。

首个管理员的产生方式：迁移不自动赋权，第一个 `is_admin = true` 由人工 SQL / 手动更新写入（一次性操作，写进文档即可）。此后管理员可以在用户管理里给其他人授予/撤销管理员（授予操作同样走 ConfirmModal）。

### 2. 权限模型与路由

- 新增 `requireAdmin()`（`features/admin/guard.ts` 或就近放置）：`requireUser()` 之上再查 `is_admin`，非管理员重定向到其个人 dashboard（不透露 /admin 存在）。
- 路由全部在 `apps/web/src/app/admin/` 下，**不放进** `(dashboard)` 路由组；`admin/layout.tsx` 调 `requireAdmin()`，提供独立的轻量布局（左侧窄侧边栏：概览 / 注册码 / 用户 三个模块 + 返回业务区的链接）。
- 每个管理 Server Action（`features/admin/actions.ts`）在函数体内重新校验 `is_admin`，不信任 layout。
- 登录后业务导航对管理员**不**显示 /admin 入口也可以接受（管理员直接输 URL / 收藏夹进入）；若实现成本低，可在用户菜单加一个入口——留给 builder 按现有导航结构取舍，倾向不加，保持业务 UI 干净。

### 3. 禁用语义（立即生效，不靠 cron）

禁用一个用户 = 三处生效：

1. **登录被拒**：better-auth 请求钩子（`authRequestHooks.before`，`features/auth/hooks.ts`）预查 `is_disabled`。注意实际登录路径是 **`/sign-in/username`**（username 插件，action 层走 `auth.api.signInUsername`），不是 `/sign-in/email`——钩子必须按真实路径拦截（或对全部 sign-in 路径生效）。命中即抛 `APIError` 令牌（沿用 `AUTH_ERROR_TOKENS` 模式，如 `accountDisabled`）。i18n key 放 **`auth`** 命名空间——`mapAuthError` 硬编码映射为 `auth.<key>`，不要放 `errors`。
2. **现有会话立即失效**：检查放在 **`getCurrentUser()`**（`features/auth/session.ts`，带缓存的底层取用户函数），而不是只放 `requireUser()`——全仓库的 Server Action 都经 `getCurrentUser()` 鉴权，只有一处用 `requireUser()`；只拦 RSC 入口的话，被禁用户的活动会话在加载页面之前仍能通过 Action 完整操作，违反"立即生效"。命中 `is_disabled` 则删除该用户全部 session 行（等效强制下线）并跳转 `/login`。
3. **禁止再注册场景不存在**：注册凭注册码，与禁用状态无关，不改。

解禁 = 翻回 `is_disabled = false`，用户下次正常登录（旧会话已在禁用时删除）。

### 4. 模块细节

**概览页**（`/admin`）：单次 RSC 查询若干计数（users / teams / projects / tasks 总数、注册码总剩余名额、耗尽/临近耗尽的码数量——**临近耗尽 = 剩余 ≤ 2**，阈值先写死，不值得做成配置）。纯展示，无操作。

**注册码管理**（`/admin/registration-codes`）：
- 新增表单：`max_uses`（整数，默认 10，与 schema 默认一致）；码由服务层用现有生成器生成，失败重试由唯一索引兜底。成功后 toast + 列表刷新。
- 列表：一行一码，含限额/已用/剩余/创建时间；使用者列表放行展开（或抽屉）里：uid、用户名、注册时间。分页：封测量级（几百用户、几十码）先不做分页，超过 ~200 条再做——留给 builder 判断，倾向简单 limit。

**用户管理**（`/admin/users`）：
- 列表：uid、用户名、展示名、邮箱、注册时间、状态（正常/禁用/管理员标记）、所属团队数。搜索框（用户名/邮箱/uid 模糊匹配，服务层 `ilike`）。
- 详情：点击进入 `/admin/users/[userId]`——基本信息、所属团队（名称+角色）、最近会话（时间/IP/UA，只读展示）、注册码（若有）。操作区：禁用/解禁按钮（ConfirmModal）、授予/撤销管理员（ConfirmModal）。
- 防呆：管理员不能禁用自己、不能撤销自己的管理员身份（服务层校验，错误走 `admin` 命名空间）。

### 5. 代码组织

- 新域 `apps/web/src/features/admin/`：`actions.ts` / `service.ts` / `components/` / `guard.ts`。
- 跨域复用：注册码生成器（`features/auth/registration-codes.ts` 一带）、`ConfirmModal`、`EmptyState`、`PageHeader` 等既有 composites。
- i18n：新增 `admin` 命名空间（模块标题、表头、按钮、确认弹窗文案、服务错误 key）；登录拒绝的 key 放 `errors`。zh/en 同步。
- Drizzle 行类型不跨层：service 查询后在 features 层映射为可序列化 domain model。

### 6. 测试

- 服务层单测：非管理员调用 admin action 被拒；禁用用户登录被拒（better-auth 钩子，路径 `/sign-in/username`）；禁用后 `getCurrentUser` 清会话并跳转；防呆规则（不能操作自己）；管理员可以禁用/撤权其他管理员；注册码新增（生成 + 限额持久化）；注册钩子写入 `registration_code_id`。
- messages-parity / cjk-guard 随新文案自然覆盖。
- e2e 新增一个 smoke flow：管理员登录 → 新增注册码 → 列表可见 → 禁用一个用户 → 该用户登录被拒 → 解禁恢复。注意 e2e 种子机制很薄（`e2e/global-setup.ts` 只播种注册码，用户都是在 spec 里经 UI 注册的）：管理员测试账号的做法（注册后 SQL 翻 `is_admin`，或直接 INSERT 一个 better-auth 格式密码哈希——密码在 `accounts.password`，普通 INSERT 造的号登不进去）由计划阶段定，两条路都可行。

## 留给 builder 的部分

- 侧边栏视觉细节（宽度、图标、Motion 交互）——按现有 dashboard 模块导航的气质做，不对照任何原型。
- 搜索防抖与表单态（client wrapper 组织）。
- 使用者列表的展开/抽屉形态。
- 计数查询的合并方式（单趟多 count 或多查询）。
- 概览数字是否需要"较上周"之类的趋势——第一期不做，若顺手可留接口位。
