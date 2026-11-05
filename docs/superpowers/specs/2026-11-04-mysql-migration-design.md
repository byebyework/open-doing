# 数据库迁移设计:PostgreSQL → MySQL 8.0

日期:2026-11-04
状态:已与需求方确认的设计,待写实现计划

## 背景与动机(Why)

云上基础设施**只提供 MySQL**,PostgreSQL 不可用,因此本次迁移是硬约束驱动的,方向不需要再论证。当前系统没有任何真实使用数据,仅本地开发库与 seed 数据,所以**不需要数据迁移脚本**:新库直接重放迁移 + `pnpm db:seed` 即可。

## 目标 / 非目标 / 反目标

- **目标**:整个应用在 MySQL 8.0 上行为与现状完全一致——所有测试(单元/集成/e2e)通过,时区语义(Asia/Shanghai 的"今天")、通知幂等投递、级联删除兜底全部保持。
- **非目标**:不改任何业务逻辑、不改 UI、不改 API 形状;不引入读写分离、连接池中间件等新架构;不写 PG→MySQL 数据搬迁工具。
- **反目标**:借机重构 schema 或 service 层结构(除迁移必需的最小改动外,保持原样);任何"顺手优化"。

## 约束

- 目标数据库:**阿里云 RDS MySQL 8.0**(标准托管实例,已确认支持外键与 `ON DELETE CASCADE`);仅在生产环境可连接,本地开发/测试/验收全部走 docker MySQL。
  - 云上小版本未知,实现方不依赖直连验证;由需求方在控制台确认。因此所有版本相关行为按"最保守"设计:正确性不依赖 8.0.16+ 的 CHECK 强制(见决策 7)。
  - TLS:阿里云 RDS 默认可选,连接配置不强制 TLS;后续若云侧要求,通过 `DATABASE_URL` 的连接参数开启,不单独改造 `client.ts`。
- 本地开发端口:5432 曾被占用是 PG 换 5433 的历史原因;MySQL 默认 3306 同样可能被本机占用,docker-compose 必须提供 `MYSQL_PORT` 覆盖(默认 3307)。
- 项目既有的冻结契约、权限模型、i18n 约束不受影响,继续遵守。
- 遵守仓库 AGENTS.md 的全部规范(提交格式、测试要求、i18n 守卫等)。

## 已定决策

### 决策 1:驱动与方言

- 驱动:`postgres` → `mysql2/promise`。
- Drizzle:`drizzle-orm/pg-core` → `drizzle-orm/mysql-core`;`drizzle-orm/postgres-js` → `drizzle-orm/mysql2`;`MySqlDatabase` 替换 `PostgresJsDatabase`。
- `drizzle.config.ts`:`dialect: "mysql"`。

### 决策 2:会话时区固定 +08:00

代码中约 15 处原生 SQL 使用 PG 时区语法(`::timestamp AT TIME ZONE 'Asia/Shanghai'`、`::date` 强转)。策略:

- **连接层**固定会话时区为 `+08:00`(mysql2 连接配置 / 初始化 `SET time_zone = '+08:00'`),应用不再让数据库做时区换算;
- **应用层**用 dayjs(Asia/Shanghai)先把窗口边界算成 naive 日期时间字符串再作为参数传入,数据库只做存储与比较;
- PG 专属语法逐一改写:`AT TIME ZONE` → 删除(边界已算好);`ORDER BY x ASC NULLS LAST` → `ORDER BY x IS NULL ASC, x ASC`;`onConflict` → `onDuplicateKeyUpdate`。

这是全迁移**最大的风险点**:过期/临期判断、cron 到期扫描、analysis 统计窗口、kanban 排序都依赖"今天"的语义,必须整组回归测试覆盖。

### 决策 3:UUID 主键改为应用层生成

MySQL 无 `gen_random_uuid()`。所有 11 张表的 `uuid().primaryKey().defaultRandom()` 改为 `char(36)` 列 + `$defaultFn(() => crypto.randomUUID())`。ID 对外本就是 opaque,外部行为不变。外键列同类型 `char(36)`。

### 决策 4:部分唯一索引(5 处)的改写

| 索引 | 方案 |
|---|---|
| `notifications (user_id, task_id, type) WHERE task_id IS NOT NULL` | 直接改普通唯一索引。MySQL 唯一索引中 NULL 互不相等,`task_id` 为 NULL 的行天然豁免,语义与 PG 部分索引一致 |
| `projects (team_id, slug) WHERE team_id IS NOT NULL` | 同上,普通唯一索引,NULL 豁免即"个人项目不受团队内唯一约束" |
| `projects (owner_id, slug) WHERE owner_id IS NOT NULL` | 同上 |
| `team_invites (team_id, invitee_id) WHERE status = 'pending'` | 两列均非空,无法用 NULL 豁免。加生成列 `pending_scope`(`status = 'pending'` 时为 `'pending'`,否则 NULL),唯一索引改为 `(team_id, invitee_id, pending_scope)` |
| `team_join_requests (team_id, user_id) WHERE status = 'pending'` | 同上 |

普通二级索引(非唯一)一律去掉 `.where()`,改普通索引——这几张表数据量小,过滤条件由查询本身承担。

### 决策 5:列类型映射

- 带唯一索引/普通索引的 `text` 列(uid、username、slug、join_code、status、language、space_type 等)→ `varchar(255)`(MySQL 对 TEXT 建索引必须前缀长度,统一换 varchar 更干净)。
- 纯内容列(description、comments.content)→ `text`。
- **校验规则**:标识列与枚举值列(username、uid、slug、join_code、status、language、space_type、role)声明 `utf8mb4_bin`,保持 PostgreSQL 的**精确匹配**语义(大小写敏感)——否则 `Alice`/`alice` 会在唯一约束和等值查询上产生 PG 不会有的冲突,违背"行为一致"目标。纯内容列用表默认 `utf8mb4_0900_ai_ci`。
- `timestamp({ withTimezone: true })` → `timestamp()`(MySQL TIMESTAMP,配合会话时区 +08:00);注意 MySQL TIMESTAMP 上限 2038,对 v1 可接受。
- `date({ mode: "string" })` → `date({ mode: "string" })`,语义一致。
- `boolean` → `boolean`(drizzle mysql 映射 tinyint(1))。

### 决策 6:`.returning()` 全量改写

MySQL 无 `RETURNING`。改写模式:

- 源码 43 处(12 个文件):insert 用 `.$returningId()`(Drizzle mysql 方言)拿主键,再按主键 select;或对已知单行场景直接构造返回对象。update/delete:同事务内按主键回查。
- 测试文件约 17 个(117 处)同样改写:更简单——ID 由应用层生成,fixture 直接构造返回对象,无需回查。
- 统一改写模式,避免各处自创写法;具体每处怎么落由实现计划逐文件处理。

### 决策 7:CHECK 约束与错误识别(双保险)

- `projects_team_or_owner_check` 在迁移中保留(阿里云 RDS 8.0.16+ 会强制;更早小版本静默忽略,无害)。
- **同时在 service 层加断言**(项目已有"应用层保证个人任务 assignee 恒为本人"的同类先例),使正确性不依赖云上小版本。
- `errors.ts`:PG 错误码 `23505` + "duplicate key value violates unique constraint" 识别 → mysql2 的 `ER_DUP_ENTRY`(`errno === 1062` / `code === 'ER_DUP_ENTRY'`);`errorChain` 遍历逻辑对 mysql2 错误结构复查。

### 决策 8:迁移文件与测试基建

- 现有 4 个 PG 迁移文件**作废删除**,用 drizzle-kit 对 MySQL 重新生成全新 `0000_init`(迁移必须可在空库重放,沿用现有要求)。
- `testing.ts`:`migrate` 换 mysql migrator;`TRUNCATE ... RESTART IDENTITY CASCADE` → `SET FOREIGN_KEY_CHECKS = 0` + TRUNCATE 各表 + `SET FOREIGN_KEY_CHECKS = 1`。
- `docker-compose.yml`:`mysql:8.0` 镜像,`MYSQL_PORT` 覆盖(默认 3307),charset `utf8mb4`、collation `utf8mb4_0900_ai_ci`(标识列在列级覆盖为 `utf8mb4_bin`,见决策 5),初始化建 `open_doing` / `open_doing_test` / `open_doing_e2e` 三库(对齐现状)。
- `.env.example`:`mysql://` 连接串、端口说明同步改写。
- 记忆中的注意事项继续适用:环境变量放 `apps/web/.env.local`,vitest/drizzle-kit 不读它;e2e 前停 dev server。

### 决策 9:文档与守卫

- `AGENTS.md`、`docs/ARCHITECTURE.md` 中 PostgreSQL 相关表述同步更新;`docs/2026-10-21-open-doing-v1-design.md` 若仅在技术栈列举中提及,补一行迁移说明即可(产品文档以"what/why"为主)。
- `schema.test.ts`、`AtomsShadcn.test.tsx` 等守卫测试涉及的断言随实现同步。

## 留给实现计划(builder)的部分

- 43 处 `.returning()` 逐文件的改写清单与每处选型(insert 已知主键可直取 / 需回查);测试文件 fixture 的统一改写。
- 约 15 处原生 SQL 的逐条改写与对应测试(`count(*) FILTER` → `SUM(CASE ...)`、`::int`/`::date` 强转、`due-scan.ts` 的 `onConflictDoNothing` → INSERT IGNORE 或等价写法)。
- `seed.ts`、`schema.test.ts` 的具体改动。
- 时区语义回归测试清单:due-scan cron、analysis 周窗口、kanban "今天"边界、overdue/due-soon 展示。
- MySQL 8.0 小版本验证步骤(CHECK 生效与否)。
- e2e(Playwright,`open_doing_e2e` 库)与 `apps/web/scripts/e2e-with-db-guard.sh`(psql → mysql)的配置改动。
- 提交拆分建议(建议:基建与 schema 一体、service 层改写、测试与文档,可再细分)。

## 未来切回 PostgreSQL 的路径(需求方关切记录)

需求方关切:若后续 MySQL 性能不足,可能切回 PostgreSQL。设计上的应对:

- 本次迁移的所有决策刻意落在**两方言公共子集**上(UUID 应用层生成、无部分索引、时区边界应用层计算、无 `RETURNING` 依赖、精确匹配校验)。迁移完成后代码库不含任何 PG 专属写法,本文档的决策表即为反向映射剧本——切回 PG 是一次与本次对称的机械迁移,认知成本已被文档化消解。
- **如实记录的边界**:若切换的动因是性能,届时大概率会想用 PG 的长处(窗口函数、部分索引、更强的优化器)重写慢查询,公共子集会在这时被有意打破——因此**不要**为"可切换性"提前建抽象层:它挡不住方言差异的本质成本,还会在使用 PG 长处时成为障碍。切换成本的可控性来自这份剧本,不来自架构隔离。
- 真正发生性能问题时,优先杠杆是索引与缓存,而非更换数据库引擎。

## 验收标准

1. `docker compose up -d --wait` 起 MySQL 三库,`pnpm db:migrate` + `pnpm db:seed` 在空库上成功。
2. `pnpm lint`、`pnpm test`(Vitest 全量)、`pnpm typecheck` 通过。
3. 受影响 e2e flow 全部通过(时区相关 flow 优先)。
4. 代码中不再出现 `pg-core`、`postgres` 驱动、PG 错误码、`AT TIME ZONE`、`NULLS LAST`、`.returning(` 等残留(grep 可验证)。
5. 文档(AGENTS.md / ARCHITECTURE.md / .env.example)与实际栈一致。
