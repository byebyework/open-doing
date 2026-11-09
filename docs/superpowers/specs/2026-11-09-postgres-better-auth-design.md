# 数据库迁回 PostgreSQL + 认证切换 better-auth 设计

日期:2026-11-09
状态:已与需求方确认的设计,待写实现计划

## 背景与动机(Why)

1. **PostgreSQL**:云上基础设施现已提供托管 PostgreSQL(此前只提供 MySQL,这是 11-04 迁往 MySQL 的硬约束;该约束已消失)。仓库内无真实使用数据(本地开发阶段),不需要数据搬迁脚本。
2. **better-auth**:替换自研认证(jose 无状态 JWT + 自写注册/登录/改密服务)。理由:成熟方案比自研可靠,且为后续接入 better-auth 插件能力(OAuth、组织管理等)打基础。

参考剧本:`docs/superpowers/specs/2026-11-04-mysql-migration-design.md`。那次迁移刻意把代码停在两方言公共子集内,本文档的 PG 部分即该剧本的**反向映射**,大部分是对称的机械改写。

## 目标 / 非目标 / 反目标

- **目标**:
  1. 全应用在 PostgreSQL 上行为与现状一致(除下述明确的产品变更外)——全部测试通过,时区语义(Asia/Shanghai 的"今天")、通知幂等投递、级联删除兜底保持。
  2. 认证由 better-auth 承担:邮箱+密码+用户名登录、会话管理、改密、限流;注册码封测机制保留且语义不变。
- **明确的产品变更(需求方已确认)**:**注册时邮箱从可选改为必填**。登录方式不变(用户名登录;better-auth 的 signIn.email 能力在 API 层免费获得,但 UI 本期不加)。
- **非目标**:不改业务逻辑、不改 UI 视觉(注册表单仅加邮箱必填校验)、不改路由与权限模型;不接入 OAuth 等任何 better-auth 插件(只留扩展空间);不写数据搬迁工具。
- **反目标**:借机重构 schema 或 service 层结构(除两个改造必需的最小改动外);为"可切换性"引入抽象层(旧文档明确反对);一次性同时做 PG 迁移和 auth 切换导致无法二分定位(见实施顺序)。

## 约束

- 目标数据库:**云上托管 PostgreSQL,版本 13+**(需求方控制台确认)——`gen_random_uuid()` 内置可用,TLS 不强制(如后续云侧要求,通过 `DATABASE_URL` 连接参数开启,不改造 `client.ts`)。是否处于池化代理(PgBouncer 类)之后**未知**:按直连设计默认连接参数,在 `client.ts` 留下切换注释(事务模式池化需 `prepare: false`),部署时验证。
- 本地端口:恢复历史约定 **5433**(5432 常被本机 PG 占用),docker-compose 提供 `PG_PORT` 覆盖。
- better-auth 版本取当前最新稳定版;Node 20+;与 Next.js 16 / React 19 / drizzle-orm 最新版兼容性由实现计划验证。
- 项目冻结契约(`AppShell`、`(dashboard)/layout.tsx` 导入关系)、权限模型、i18n 约束全部继续遵守。
- i18n:登录/注册/改密的全部错误文案走消息目录;better-auth 报错在 action 层映射翻译;`cjk-guard` / `messages-parity` 测试照常生效。
- 遵守仓库 AGENTS.md 全部规范。

## 实施顺序(两个独立阶段,各自可验证、可提交)

**阶段 A:MySQL → PostgreSQL**。行为与现状完全一致,全部既有测试通过。
**阶段 B:自研认证 → better-auth**(在 PG 之上),含"邮箱必填"产品变更。

分开提交,保证任一阶段出问题可单独定位/回滚。

## 阶段 A:迁回 PostgreSQL(镜像旧剧本)

### 决策 A1:驱动与方言

- 驱动:`mysql2/promise` → `postgres`(postgres-js,恢复迁移前原驱动)。
- Drizzle:`drizzle-orm/mysql-core` → `drizzle-orm/pg-core`;`drizzle-orm/mysql2` → `drizzle-orm/postgres-js`。
- `drizzle.config.ts`:`dialect: "postgresql"`。
- `client.ts`:恢复单例 postgres-js client;删除 `SET time_zone` 会话时区逻辑与 `timezone: "+08:00"`(PG timestamptz 存绝对时刻,不依赖会话时区,见 A3)。托管实例若要求关闭 prepared statements(池化代理场景),通过连接串参数处理,不改变代码结构。

### 决策 A2:UUID 主键恢复原生类型

`char(36)` + `$defaultFn` → `uuid().primaryKey().defaultRandom()`;外键列 `uuid("xxx")`。ID 对外仍是 opaque string,外部行为不变。`$returningId()` 及回查模式全量恢复 `.returning()`(见 A6)。

### 决策 A3:时间戳恢复 timestamptz

删除自定义 `tzTimestamp`(2026-11-05 记忆中"保留 tzTimestamp"的注意事项随本次迁移**作废**)。`timestamp` → `timestamp({ withTimezone: true })`,默认 `defaultNow()`。约 15 处原生 SQL 恢复 PG 写法:`AT TIME ZONE 'Asia/Shanghai'`、`::date`/`::int` 强转、`NULLS LAST`、`onConflictDoNothing`、`count(*) FILTER` 等——逐条对照旧剧本"决策 2"反向改写,这是全迁移最大风险点,须整组回归测试覆盖(due-scan cron、analysis 周窗口、kanban"今天"边界、overdue/due-soon 展示)。

### 决策 A4:部分唯一索引恢复(5 处)

| 现状(MySQL) | 恢复为(PG) |
|---|---|
| `notifications (user_id, task_id, type)` 普通唯一索引 + NULL 豁免 | `uniqueIndex(...).on(userId, taskId, type).where(isNotNull(taskId))` |
| `projects (team_id, slug)` / `(owner_id, slug)` | 恢复 `.where()` 部分索引 |
| `team_invites` / `team_join_requests` 的 `pending_scope` 生成列 + 三列唯一索引 | 删除生成列,恢复 `.where(status = 'pending')` 部分唯一索引 |

### 决策 A5:列类型

- `identifierVarchar`(`utf8mb4_bin`)→ PG `text`(PG 默认大小写敏感,精确匹配语义天然保持);`unique()` 索引列 `text` 即可。
- `email` 列在阶段 B 变更为 `notNull`(见 B1);阶段 A 先保持 nullable。
- `varchar(50)`(nickname)/`varchar(255)`(password_hash)/`varchar(500)`(title)恢复为迁移前 PG 时代类型(text 或维持 varchar,以旧 PG 迁移前基线为准,由实现计划对照 git 历史确定)。
- `date({ mode: "string" })`、`boolean` 不变。

### 决策 A6:`.returning()` 全量恢复

MySQL 无 RETURNING;PG 恢复。旧剧本记录:源码 43 处(12 文件)+ 测试 fixture 约 117 处(17 文件)——反向恢复,逐文件清单留给实现计划。

### 决策 A7:错误识别恢复

`errors.ts`:`ER_DUP_ENTRY`/`errno 1062` → PG SQLSTATE `23505` + `duplicate key value violates unique constraint`;`uniqueViolationKey` 从驱动错误的 `constraint_name`/message 提取索引名。`isUniqueViolation` / `errorChain` 对 postgres-js 错误结构复查。

### 决策 A8:迁移文件与测试基建

- 现有 4 个 MySQL 迁移文件**作废删除**,drizzle-kit 对 PG 重新生成全新 `0000_init`(空库可重放)。
- `testing.ts`:postgres migrator;`SET FOREIGN_KEY_CHECKS` + TRUNCATE → `TRUNCATE ... RESTART IDENTITY CASCADE`(单连接即可,可保留但不再是必需)。
- e2e `global-setup.ts` 的清表清单逐表同步;`e2e/flows/06-space-kanban.spec.ts` 的 `DATE_SUB(NOW(), INTERVAL ? DAY)` 恢复 PG `::interval` 写法;`e2e-with-db-guard.sh` mysql 探测恢复 psql。
- `docker-compose.yml`:`mysql:8.0` → `postgres:16`,端口 `${PG_PORT:-5433}:5432`,initdb 脚本建 `open_doing` / `open_doing_test` / `open_doing_e2e` 三库;删除 `docker/initdb` 下的 MySQL 初始化文件。
- `.env.example`:`postgres://` 连接串、`PG_PORT` 说明。
- `pnpm db:seed` 在 PG 上重放验证。

### 决策 A9:文档与守卫

`AGENTS.md`、`docs/ARCHITECTURE.md`、`apps/web` 内 MySQL 相关注释(含 schema.ts 文件头决策记录、client.ts/testing.ts 注释)全部同步;守卫测试断言随实现同步。

### 验收(阶段 A)

1. `docker compose up -d --wait` 起 PG 三库,`pnpm db:migrate` + `pnpm db:seed` 空库成功。
2. `pnpm lint`、`pnpm test`、`pnpm typecheck`(先 typegen)通过;受影响 e2e flow 通过。
3. grep 无残留:`mysql-core`、`mysql2`、`$returningId`、`ER_DUP_ENTRY`、`tzTimestamp`、`utf8mb4`、`3307`(文档/配置中的 MySQL 痕迹)。
4. 文档与实际栈一致。

## 阶段 B:自研认证 → better-auth

### 决策 B1:用户模型与"邮箱必填"

`users` 表同时承担 better-auth 的 user 模型与我们的业务字段:

- **email:notNull + unique + 应用层 lowercase 归一化(现有逻辑保留)**;注册时必填(产品变更,需求方已确认)。better-auth 的 email 查重与唯一冲突映射沿用现有 `EMAIL_TAKEN` 错误链路。
- **emailVerified: boolean notNull default false**(better-auth 必需;本期无邮箱验证流程,恒 false)。
- **name: text notNull**:承接 better-auth 必需的 `name`,替代现有 `nickname` 列——语义即"展示名":注册未填时按现规则生成 `user_<hash5>`,修改昵称时同步更新 `name`。领域模型 `User.nickname` 由 `name` 映射(不再有 null 分支)。此映射是实现细节,若实现计划发现更平滑的等价方案(如保留 nickname 列 + 钩子同步 name)可替代,以最小侵入为准。
- **image: text nullable**(better-auth 标准,本期不使用)。
- **username / displayUsername**:username 插件所需的列;现有 `username` 列(unique、大小写敏感)直接映射为插件的 `username` 字段;`displayUsername` 按 better-auth 当前版本要求增加(与 username 同值即可)。**保持现有大小写敏感语义**:插件若默认 lowercase 归一化,必须配置关闭(实现计划核实该版本的插件选项)。
- 业务字段保持不动:`gender`、`phone`、`language`、`due_soon_reminder_enabled`、`overdue_reminder_enabled`(drizzle adapter 对表上的额外列不做管理,按现有默认值运作)。
- **`password_hash` 列删除**(被迫改动:better-auth 自建 user insert 不会写它,列 NOT NULL 无默认;密码哈希由 `account` 表承担)。
- **`uid`(Doing ID)生成语义**(设计定案):uid 由应用层 `generateUid()` 生成、无数据库默认,而 better-auth 自建 insert——生成点放在 `databaseHooks.user.create.before` 钩子内(与注册码消费同一钩子)。uid 撞唯一约束时抛错中止整个注册,返回通用错误由用户重试(概率极低,不做循环重试);若此刻注册码已被消费,计入已接受的"白耗名额"残余风险,注释中如实注明。
- 其余 better-auth 标准表新增:`session`、`account`、`verification`(列结构按 better-auth 版本文档/`@better-auth/cli generate` 生成后合并进 `schema.ts`,由 drizzle-kit 出迁移)。`registration_codes`、`teams` 等其余表不动。

### 决策 B2:better-auth 实例与接入点

- 新增依赖 `better-auth`;实例集中定义(如 `features/auth/server.ts`):`drizzleAdapter(db, { provider: "pg", schema })` + `emailAndPassword.enabled` + `username()` 插件;`session.expiresIn` 30 天(对齐现状)。内置限流取默认值。
- 密码哈希:better-auth 默认(scrypt)。现有 `@node-rs/argon2` 依赖删除(无存量哈希需要兼容)。密码最小长度 8 对齐现有 `PASSWORD_MIN_LENGTH`。
- **注册**:action 层调 `auth.api.signUpUsername`(用户名+邮箱+密码+昵称等资料)。注册码校验与消费通过 better-auth hooks 接入:
  - `hooks.before`(sign-up 路径):注册码格式/存在性快速失败,错误映射到 `registrationCode` 字段;
  - `databaseHooks.user.create.before`:原子条件扣减(`consumeRegistrationCode` 现有逻辑复用),抛错中止注册。
  - **需实现计划核实**:better-auth 的 drizzle adapter 在 signUpUsername 中是否把 user+account 创建包在同一事务、databaseHooks 是否随之处于事务内。若是 → 注册码消费与建号原子,语义与现状完全一致;若否 → 如实记录残余风险(建号失败时码被白耗一名额),并在文档/注释中注明,不做复杂补偿(封测阶段名额浪费可接受)。
- **登录**:`auth.api.signInUsername`(用户名)——UI 不变;`signIn.email` 能力免费存在,本期不暴露。
- **登出 / 改密**:`auth.api.signOut` / `auth.api.changePassword`(开启 `revokeOtherSessions`,行为改进:改密后吊销其他会话;现状是旧 JWT 继续有效,属有意的行为变更)。
- **会话**:better-auth 默认数据库会话(session 表 + httpOnly cookie),替换 jose 无状态 JWT。删除 `jose` 依赖、`SESSION_COOKIE_NAME`/`signSessionToken` 等自研会话代码。
- **守卫不变**:`requireUser()` / `getCurrentUser()` 签名与调用方完全不变,内部改为 `auth.api.getSession({ headers: await headers() })`(React `cache()` 按请求缓存保留);`getUserById` 等用户资料查询路径不变。
- `SESSION_SECRET` 更名 `BETTER_AUTH_SECRET`(缺失时 dev 回退固定开发值的现有模式保留);`.env.example`、vitest/drizzle-kit 导出清单、e2e 脚本同步;better-auth 所需的 baseURL / trusted origins 同样只在 `.env.example` 与文档中说明。
- **交付范围(设计定案)**:本设计是纯仓库改动,验收止于本地三库全绿;不做云上部署/下线序列,不写数据搬迁工具(本地开发阶段、无真实数据,需求方确认)。
- **i18n / 错误映射**:better-auth 错误码 → `auth` 命名空间消息键的映射表集中在 action 层(如 `INVALID_USERNAME_OR_PASSWORD` → `invalidCredentials`、`USERNAME_IS_ALREADY_TAKEN` → `usernameTaken`、注册码错误沿用现有 keys);保持"不泄露内部状态"原则(登录失败不区分用户名不存在/密码错)。
- 注册表单:邮箱字段改为必填(视觉不变,仅校验与文案),zh/en 消息目录同步(新增/调整的 key 走 parity 测试)。
- 单测重构方向:现有 `service.test.ts` 中注册/登录/改密的大部分用例转为 better-auth 集成层用例(hook 消费注册码、错误映射、session 接线);`session.test.ts` 相应改写;`registration-codes` 单测保留。

### 决策 B3:测试与 e2e

- vitest:e2e/集成库不变(`open_doing_test`),`testing.ts` 迁移重放自动覆盖新表。
- Playwright:登录/注册/登出/改密/设置相关 flow 全部适配;`db-guard` 与 `SESSION_SECRET`→`BETTER_AUTH_SECRET` 同步。
- 守卫测试:cjk-guard 扫描范围照旧。

### 验收(阶段 B)

1. 全部单测/集成/e2e 通过;`pnpm lint`、`pnpm typecheck` 通过。
2. 注册(码+邮箱必填)、用户名登录、登出、改密(其他会话被吊销)、会话过期全链路手工 + e2e 验证。
3. 未登录访问受保护路由重定向 `/login` 的行为不变;所有 Server Action 独立鉴权不受影响。
4. grep 无残留:`jose`、`SESSION_SECRET`(文档/脚本/代码)、`@node-rs/argon2`。
5. 消息目录 parity + cjk-guard 通过。

## 留给实现计划(builder)的部分

- 阶段 A:43 处 `.returning()` 与约 15 处原生 SQL 的逐文件反向清单;旧 PG 基线列类型对照(git 历史);时区回归测试清单;postgres-js 连接参数与托管 PG 的池化注意点;提交拆分建议。
- 阶段 B:better-auth 版本锁定与 `schema.ts` 新表列结构生成方式;username 插件归一化选项核实;databaseHooks 事务原子性核实(必要时 spike);`users` 列(nickname→name 等)迁移在全新库上直接由新迁移承担;错误码映射表全量枚举;e2e flow 逐个适配清单。

## 风险与已知取舍

- **阶段 A 最大风险**:原生 SQL 时区/方言改写(同旧剧本,已有整组回归测试经验可复用)。
- **阶段 B 已知取舍**:① better-auth hooks 若无事务包裹,注册码存在白耗名额的残余风险(封测可接受,如实记录);② `displayUsername`/插件列带来少量冗余存储,换取与 better-auth 生态兼容;③ 改密吊销其他会话是行为变更(改进方向,已确认);④ 注册时邮箱必填是产品变更(需求方已确认)。
