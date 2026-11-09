# PostgreSQL 迁移(阶段 A)实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 open-doing 从 MySQL 8.0 对称地迁回 PostgreSQL 16,行为与现状完全一致(全部测试通过),不引入任何业务变更。

**Architecture:** 镜像 2026-11-05 的 MySQL 迁移 commit 系列(`f444c26^` 是 PG 时代基线,`d829d46` 是迁移终点):schema 换 pg-core、驱动换 postgres-js、恢复 `.returning()` 与 PG 方言 SQL、重建迁移文件与测试基建。每个迁移 commit 的 diff 就是该处代码的"反向对照"。

**Tech Stack:** Next.js 16 / drizzle-orm(postgres-js)/ PostgreSQL 16 / Vitest / Playwright。

**Spec:** `docs/superpowers/specs/2026-11-09-postgres-better-auth-design.md`(本计划只覆盖其"阶段 A";阶段 B better-auth 另出计划)。

## Global Constraints

- 本地端口 **5433**(compose 提供 `PG_PORT` 覆盖);三库 `open_doing` / `open_doing_test` / `open_doing_e2e`。
- `vitest` / `drizzle-kit` **不读** `apps/web/.env.local`:跑测试/迁移前先 `set -a; source apps/web/.env.local; set +a`(从仓库根执行)。
- `TEST_DATABASE_URL` 会被测试清空,绝不能指向开发库;e2e 前必须停掉 `pnpm dev`(Next 16 同目录 dev lock)。
- 不改业务逻辑、不改 UI、不改路由与权限模型;不引入新抽象层。
- 冻结契约不碰:`AppShell`、`(dashboard)/layout.tsx` 导入关系。
- 时间语义:Asia/Shanghai 的"今天";timestamptz 存绝对时刻,窗口边界由应用层按上海日历日计算后作为参数传入。
- 提交信息 Conventional Commits、英文;每任务一组提交。
- 关键反向参照(执行时 `git show <commit>` 看旧→新 diff,反向恢复):`131f108` schema、`0f8131c` client/errors/testing、`dca6c10` auth/users 写路径、`0b8d895` teams、`5e30463` tasks、`44c2b32` projects、`f74b09b` seed、`e598656` 测试 fixture、`f7cbad1` analysis/my-tasks、`1d9d460` kanban、`ad6bf37` notifications returning、`ae4204b` due-scan 幂等插入、`db3dbea` e2e guard/flows、`7946929` PG 残留清理、`a192498` compose。

## Review Focus

1. **时区语义**:PG 容器默认 UTC;due-scan、analysis 周窗口、kanban 边界、overdue/due-soon 必须仍按 Asia/Shanghai 日历日。→ 由既有 tz 回归测试(`44c2b32` 引入)与 analysis/kanban 用例钉住(Task 5 验证步骤)。
2. **标识符大小写敏感**:`Alice`/`alice` 必须是不同用户名/slug/码(PG text 天然精确匹配,勿加 citext/lower 归一)。→ schema.test 唯一约束用例(Task 2)。
3. **部分唯一索引语义**:notifications 的 `(user_id, task_id, type)` 对 `task_id IS NULL` 行豁免;invites/join-requests 仅 pending 占用。→ schema.test 用例 + notifications 测试(Task 2/5)。
4. **due-scan 幂等**:同一天重复 POST 只投递一条。→ flows/04-cron-reminder.spec(Task 6)。
5. **三库隔离**:e2e 只碰 `open_doing_e2e`,开发/测试库行数不变。→ db-guard 脚本 + `assertE2EDatabaseUrl`(Task 6)。

---

### Task 1: Docker compose 换 PG + 依赖与连接串

**Files:**
- Modify: `docker-compose.yml`(mysql service → postgres)
- Modify: `docker/initdb/01-create-test-db.sh`、`docker/initdb/02-create-e2e-db.sh`(psql 建库)
- Modify: `.env.example`、`apps/web/.env.local`(本地文件,不入库)
- Modify: `apps/web/package.json`(依赖)
- Modify: 根 `.env`(如有 `COMPOSE_PROJECT_NAME`/端口覆盖则同步)

**Interfaces:**
- Produces: 后续所有任务依赖的 `docker compose up -d --wait` 三库 PG;连接串 `postgres://open-doing:open-doing@localhost:5433/open_doing`(test/e2e 库同理)。

- [ ] **Step 1: 重写 docker-compose.yml 的数据库 service**

镜像 `postgres:16`;端口 `"${PG_PORT:-5433}:5432"`;healthcheck `pg_isready -U open-doing -d open_doing`;主库由 `POSTGRES_DB: open_doing` 创建,`POSTGRES_USER/PASSWORD: open-doing`;volume `postgres_data:/var/lib/postgresql/data`;保留 initdb 挂载与 `restart: unless-stopped`。注释说明:仅数据库在容器,web 在宿主机跑;5432 常被本机 PG 占用故映射 5433。

- [ ] **Step 2: initdb 脚本改 psql**

两个脚本分别创建 `open_doing_test` / `open_doing_e2e`(与现 mysql 版语义一致,可基于 `a192498` 的旧 PG 版恢复)。

- [ ] **Step 3: 更新 .env.example 与本地 .env.local**

`DATABASE_URL=postgres://open-doing:open-doing@localhost:5433/open_doing`,`TEST_DATABASE_URL=...5433/open_doing_test`;端口覆盖说明改 `PG_PORT`;`SESSION_SECRET`/`CRON_SECRET` 条目不变。同步改写 `apps/web/.env.local`(本机实际文件)。

- [ ] **Step 4: 依赖替换**

`apps/web/package.json`:移除 `mysql2`,新增 `postgres`(最新稳定);`pnpm install`。(drizzle-orm 0.45 已含 pg-core/postgres-js,无需升级。)

- [ ] **Step 5: 验证三库就绪**

```bash
docker compose up -d --wait
docker compose exec postgres psql -U open-doing -d open_doing -c '\l'
```
Expected: 列出 open_doing / open_doing_test / open_doing_e2e。

- [ ] **Step 6: Commit**

```bash
git add docker-compose.yml docker/initdb .env.example package.json apps/web/package.json pnpm-lock.yaml
git commit -m "chore(db): replace mysql compose service with postgres 16"
```

---

### Task 2: schema 换 pg-core + 重建迁移

**Files:**
- Modify: `apps/web/src/server/db/schema.ts`(全量重写)
- Modify: `apps/web/drizzle.config.ts`
- Delete + regenerate: `apps/web/drizzle/*`(4 个 mysql 迁移 + meta)
- Test: `apps/web/src/server/db/schema.test.ts`

**Interfaces:**
- Consumes: Task 1 的 PG 三库。
- Produces: 全部表名/列名/TS 属性名**保持不变**(同 `users`、`tasks`、`tz` 列名等);`$returningId()` 消失,后续任务改用 `.returning()`;`registration_codes`/`teams`/`users` 等导出名不变。阶段 A 中 `email` 保持 nullable(邮箱必填属阶段 B)。

- [ ] **Step 1: 先改 schema.test.ts 的方言断言**

`import { getTableConfig } from "drizzle-orm/mysql-core"` → `drizzle-orm/pg-core`;删除/改写 `utf8mb4_bin` collation 断言(反向参照 `e598656`);其余用例(uuid、唯一约束、级联删除、CHECK)保持。

- [ ] **Step 2: 运行 schema.test 确认失败**

```bash
set -a; source apps/web/.env.local; set +a
pnpm vitest run apps/web/src/server/db/schema.test.ts
```
Expected: FAIL(schema 仍是 mysql 方言,与新断言不符)。

- [ ] **Step 3: 重写 schema.ts**

逐项(反向参照 `131f108` 的 diff,该 commit 的"-"侧即目标写法):
- `mysqlTable` → `pgTable`;`mysql-core` 导入 → `pg-core`。
- `uuidPk`: `char(36).$defaultFn(...)` → `uuid("id").primaryKey().defaultRandom()`;`uuidRef` → `uuid(name)`。
- 删除自定义类型 `identifierVarchar`、`tzTimestamp`(标识/枚举列直接用 `text`;时间戳列 `timestamp(name, { withTimezone: true })`,默认 `.defaultNow()`)。
- `date`/`boolean`/`int`→`integer`/`text` 保持 drizzle 语义等价写法。
- 5 处部分唯一索引恢复(反向参照旧设计文档决策 4 表):notifications `.where(isNotNull(taskId))`、projects 两个 slug 索引、team_invites/team_join_requests 恢复 `where(eq(status,'pending'))` 并**删除 `pendingScope` 生成列**。
- `projects_team_or_owner_check` CHECK 保留。
- 文件头"设计决策"注释按 PG 语义重写(1–9 条:原生 uuid、部分索引、text 精确匹配、timestamptz;删除 MySQL 专述)。
- **列名/表名/TS 属性名一字不改**。

- [ ] **Step 4: 重建迁移**

```bash
rm apps/web/drizzle/0000_*.sql apps/web/drizzle/000{1,2,3}_*.sql && rm -rf apps/web/drizzle/meta
set -a; source apps/web/.env.local; set +a
pnpm db:generate
pnpm db:migrate
```
Expected: 生成单个 `0000_*` init 迁移,空库重放成功;`pnpm db:migrate` 幂等。

- [ ] **Step 5: schema.test 通过**

Run: 同 Step 2。
Expected: PASS(唯一约束、CHECK、级联删除用例全绿)。

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/server/db/schema.ts apps/web/src/server/db/schema.test.ts apps/web/drizzle apps/web/drizzle.config.ts
git commit -m "feat(db): rewrite schema for postgresql and regenerate migrations"
```

---

### Task 3: 连接层与错误识别(client / errors / testing)

**Files:**
- Modify: `apps/web/src/server/db/client.ts`
- Modify: `apps/web/src/server/db/errors.ts`
- Modify: `apps/web/src/server/db/testing.ts`
- Test: `apps/web/src/server/db/errors.test.ts`

**Interfaces:**
- Consumes: Task 2 的 pg-core schema。
- Produces: `db: PostgresJsDatabase<typeof schema>`、`DbClient`(保持导出名;事务 client 仍可作为 `DbClient` 传参);`isUniqueViolation(error): boolean`、`uniqueViolationKey(error): UniqueKey | null`(签名不变,识别逻辑换 PG)。testing.ts 保持 `setupTestDb(): Promise<DbClient>` / `closeTestDb()` 签名。

- [ ] **Step 1: 改 errors.test.ts 期望值(先失败)**

驱动错误构造从 `errno: 1062 / code: "ER_DUP_ENTRY"` 改为 PG 形态 `{ code: "23505", constraint_name: "users_email_unique", message: 'duplicate key value violates unique constraint "users_email_unique"' }`(反向参照 `162fc13`);message 误归属的负例用例保留(参数含索引名的噪音仍不得误判)。

- [ ] **Step 2: 运行确认失败**

Run: `pnpm vitest run apps/web/src/server/db/errors.test.ts` → Expected: FAIL。

- [ ] **Step 3: 重写三个文件**

- `client.ts`(反向参照 `0f8131c`):`drizzle(postgres(url), { schema })`;删除 `SET time_zone`/`timezone` 逻辑与 mysql 注释;保留"绝不回退到 TEST_DATABASE_URL"、"生产缺失显式报错"、globalThis 单例三条不变;新增注释:事务模式池化代理(若部署后存在)需在连接串/参数关 prepared statements。
- `errors.ts`:`isUniqueViolation` 识别错误链中 `code === "23505"`(postgres-js 错误结构:驱动错误在 `.cause` 上,含 `code`/`constraint_name`);`uniqueViolationKey` 优先 `constraint_name` 精确匹配,message 正则 `duplicate key value violates unique constraint "(\w+)"` 仅对驱动错误启用(沿用现有防参数噪音设计);`UniqueKey` 三个索引名不变。
- `testing.ts`(反向参照 `0f8131c`):postgres migrator;`TRUNCATE notifications, comments, ... RESTART IDENTITY CASCADE` 单条语句替代 FOREIGN_KEY_CHECKS 循环(表清单不变);单连接池不再是必需,可简化。

- [ ] **Step 4: 测试通过**

Run: `pnpm vitest run apps/web/src/server/db/errors.test.ts apps/web/src/server/db/schema.test.ts` → Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/server/db/client.ts apps/web/src/server/db/errors.ts apps/web/src/server/db/errors.test.ts apps/web/src/server/db/testing.ts
git commit -m "feat(db): postgres-js connection layer, error codes, test bootstrap"
```

---

### Task 4: 写路径恢复 `.returning()`(service 层 + seed)

**Files(逐文件,反向参照各 commit 的 "-" 侧):**
- Modify: `apps/web/src/features/auth/service.ts`、`apps/web/src/features/users/service.ts`(参照 `dca6c10`)
- Modify: `apps/web/src/features/teams/service.ts`(`0b8d895`)、`teams/joins/service.ts`、`teams/invites/service.ts`(含 line ~362 的 `case when` 排序恢复为 PG 写法)
- Modify: `apps/web/src/features/tasks/service.ts`(`5e30463`)、`projects/service.ts`(`44c2b32`)
- Modify: `apps/web/src/features/personal/tasks/service.ts`、`personal/projects/service.ts`(随各自域 commit)
- Modify: `apps/web/src/server/db/seed.ts`(`f74b09b`)

**Interfaces:**
- Consumes: Task 3 的 `DbClient`(事务仍可用)、pg schema 的 `.returning()`。
- Produces: 各 service 函数签名与返回类型**全部不变**(阶段 A 是行为等价迁移);`registration_codes` 的原子扣减 SQL(`usedCount + 1`)本就方言中立,不动。

- [ ] **Step 1: 逐文件恢复**

统一模式(参照各 commit 旧侧):insert 的 `.$returningId()` + 回查 → `.returning()` 直取整行;update/delete 的同事务回查 → `.update(...).returning()` / `.delete(...).returning()`;测试 fixture 直构对象不变。auth/service.ts 的 `isUniqueViolation`/`uniqueViolationKey` 调用点签名未变,无需改动调用侧。

- [ ] **Step 2: 分域跑测试**

```bash
set -a; source apps/web/.env.local; set +a
pnpm vitest run apps/web/src/features/auth apps/web/src/features/teams apps/web/src/features/tasks apps/web/src/features/projects apps/web/src/features/personal
```
Expected: 全 PASS。

- [ ] **Step 3: seed 重放验证**

```bash
set -a; source apps/web/.env.local; set +a
pnpm db:migrate && pnpm db:seed && pnpm db:seed
```
Expected: 两次 seed 均成功(幂等);psql 查 users/teams 行数符合预期。

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/features apps/web/src/server/db/seed.ts
git commit -m "refactor(db): restore returning() write paths for postgresql dialect"
```

---

### Task 5: 聚合/窗口/幂等查询恢复 PG 方言

**Files(逐文件,反向参照 commit 的 "-" 侧):**
- Modify: `apps/web/src/features/analysis/service.ts`、`dashboard/my-tasks/service.ts`(参照 `f7cbad1`)
- Modify: `apps/web/src/features/kanban/service.ts`(`1d9d460`)
- Modify: `apps/web/src/features/notifications/`(due-scan 与 service:参照 `ad6bf37` + `ae4204b`)
- Modify: `apps/web/src/features/dashboard/team-overview/service.ts`(排序写法随 `f7cbad1` 域)

**Interfaces:**
- Consumes: Task 3 的 db 实例、Task 4 已恢复的 service。
- Produces: 各查询函数签名与返回类型不变。恢复要点:`count(*) FILTER (WHERE ...)`、`::int`/`::date` 强转、`AT TIME ZONE 'Asia/Shanghai'`、`(weekStart)::timestamp AT TIME ZONE ...` 边界、`NULLS LAST`(或 drizzle `asc(x, { nulls: "last" })`,以旧侧写法为准)、due-scan 恢复 `onConflictDoNothing`。

- [ ] **Step 1: 逐文件恢复**

对照各 commit 的旧侧逐行恢复;若旧侧与现接口有出入(阶段 A 后续小改动),以"行为等价 + PG 方言"为准取最接近写法,不发明新 SQL。

- [ ] **Step 2: 跑对应测试**

```bash
set -a; source apps/web/.env.local; set +a
pnpm vitest run apps/web/src/features/analysis apps/web/src/features/dashboard apps/web/src/features/kanban apps/web/src/features/notifications
```
Expected: 全 PASS(含 tz 回归用例——Review Focus 1)。

- [ ] **Step 3: 全量单测**

Run: `pnpm test`(根目录)
Expected: 全 PASS。

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/features
git commit -m "refactor(db): restore pg-dialect aggregates, windows, and idempotent insert"
```

---

### Task 6: e2e 基建与 flow 切 PG

**Files:**
- Modify: `apps/web/e2e/utils/env.ts`(`MYSQL_*` → `PGHOST/PGPORT/PGUSER/PGPASSWORD`,URL `postgres://...5433/open_doing_e2e`)
- Modify: `apps/web/e2e/global-setup.ts`(postgres-js 池、migrate、`TRUNCATE ... RESTART IDENTITY CASCADE`、注册码 INSERT 列表不变)
- Modify: `apps/web/scripts/e2e-with-db-guard.sh`(mysql 客户端/docker exec mysql → psql / `docker compose exec -T postgres psql`;快照查询换 `information_schema`+psql 等价,参照 `db3dbea` 旧侧)
- Modify: `apps/web/e2e/flows/06-space-kanban.spec.ts`(`DATE_SUB(NOW(), INTERVAL ? DAY)` → `now() - (${days} || ' days')::interval`,参照 `457d547` 记录的例外)

**Interfaces:**
- Consumes: Task 1 三库、Task 2 迁移文件。
- Produces: `pnpm --filter @open-doing/web test:e2e` 全流程可用;`E2E_DATABASE_URL` 仍强制指向 `open_doing_e2e`。

- [ ] **Step 1: 改写上述文件**

- [ ] **Step 2: 停 dev server 后跑单条 flow 验证**

```bash
# 确保 pnpm dev 已停止
set -a; source apps/web/.env.local; set +a
pnpm --filter @open-doing/web test:e2e -- flows/04-cron-reminder.spec.ts
```
Expected: PASS(due-scan 幂等——Review Focus 4);db-guard 输出开发/测试库行数不变(Review Focus 5)。

- [ ] **Step 3: 全量 e2e**

Run: `pnpm --filter @open-doing/web test:e2e`
Expected: 全 PASS(首次跑前 chromium 已装则直接跑)。

- [ ] **Step 4: Commit**

```bash
git add apps/web/e2e apps/web/scripts/e2e-with-db-guard.sh
git commit -m "chore(e2e): port db guard, global setup, and flows to postgres"
```

---

### Task 7: 文档同步 + 残留清扫 + 终验

**Files:**
- Modify: `AGENTS.md`、`docs/ARCHITECTURE.md`(MySQL 表述 → PostgreSQL;命令注释端口 3307→5433、mysql→psql、"vitest/drizzle-kit 不读 .env.local" 提示不变)
- Modify: `docs/2026-10-21-open-doing-v1-design.md`(若技术栈列举提及 MySQL,补迁移说明)
- Sweep: 全仓 grep 残留

- [ ] **Step 1: 文档改写**(措辞参照 `b9a8950`/`d829d46` 的反向;不动产品 what/why 部分)

- [ ] **Step 2: 残留 grep(参照 `7946929` 的清扫范围)**

```bash
grep -rn "mysql-core\|mysql2\|returningId\|ER_DUP_ENTRY\|tzTimestamp\|utf8mb4\|3307\|MYSQL_\|SET time_zone" --include='*.ts' --include='*.tsx' --include='*.sh' --include='*.yml' --include='*.md' apps/web/src apps/web/e2e apps/web/scripts apps/web/drizzle.config.ts docker-compose.yml .env.example AGENTS.md docs/ARCHITECTURE.md | grep -v 'specs/2026-11\|plans/\|superpowers'
```
Expected: 仅剩历史设计文档/计划中的合理引用。

- [ ] **Step 3: 终验**

```bash
pnpm lint && pnpm typecheck && pnpm test
pnpm --filter @open-doing/web test:e2e
```
(typecheck 前如需先生成路由类型:`pnpm --filter @open-doing/web exec next typegen`。)
Expected: 全绿。

- [ ] **Step 4: Commit**

```bash
git add AGENTS.md docs
git commit -m "docs(db): sync guides to postgresql stack"
```

- [ ] **Step 5: 更新记忆(收尾)**

`~/.claude/projects/-Users-wangtao-sourcecode-open-doing/memory/local-dev-db-port-5434.md` 已过时(MySQL/3307/保留 tzTimestamp 的注意事项作废):改写为 PG/5433/连接串事实。
