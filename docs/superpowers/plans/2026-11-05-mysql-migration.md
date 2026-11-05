# PostgreSQL → MySQL Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate open-doing's database from PostgreSQL to MySQL 8.0 with zero behavior change (no data migration needed — only seed data exists).

**Architecture:** Swap the Drizzle dialect (`pg-core` → `mysql-core`), driver (`postgres` → `mysql2/promise`), and regenerate migrations. Session timezone pinned to `+08:00`; all timezone math moves app-side (dayjs, Asia/Shanghai). All 43 source `.returning()` sites rewritten to `$returningId()` + re-select patterns; `count(*) FILTER` rewrites to `SUM(CASE)`. Tasks 1–4 flip the foundation (green `schema.test.ts` is the first gate); Tasks 5–11 rewrite feature services one domain at a time with each domain's existing tests as the gate.

**Tech Stack:** Next.js monorepo, Drizzle ORM 0.45 (verified: `$returningId`, `generatedAlwaysAs`, `check` supported on mysql-core; per-column collation NOT — expressed via `customType`), mysql2, docker compose MySQL 8.0.

**Spec:** `docs/superpowers/specs/2026-11-04-mysql-migration-design.md` — read it first; every decision below cites it.

## Global Constraints

- Target: MySQL 8.0 (Aliyun RDS in prod, docker locally). **Correctness must NOT depend on ≥8.0.16 CHECK enforcement** — keep the DB CHECK and add a service-layer assertion (spec decision 7).
- No business logic, UI, or API changes. Service public signatures and `ActionResult` shapes stay byte-identical.
- DB charset `utf8mb4` / `utf8mb4_0900_ai_ci`; identifier/enum columns case-sensitive via `utf8mb4_bin` (spec decision 5).
- Primary keys: `char(36)` + app-side `crypto.randomUUID()` via `$defaultFn` (spec decision 3).
- Session timezone `+08:00` pinned at the connection layer; database never does timezone conversion (spec decision 2).
- Old PG migration files are deleted; the new `0000` migration must replay on an empty database.
- Env vars live in `apps/web/.env.local` (Next.js), but **vitest/drizzle-kit don't read it** — run `set -a; source apps/web/.env.local; set +a` before any test/migration command.
- Between Task 2 and Task 11, `pnpm typecheck` and unrelated tests fail by design (big-bang dialect flip). Per-task gates below are the source of truth; the full gate comes in Task 12/13.
- Conventional Commits, English subjects, no trailing period. End commit messages with `Co-Authored-By: Claude Code <noreply@anthropic.com>`.
- e2e requires the dev server stopped (Next 16 same-dir dev lock).

## Shared Rewrite Rules (referenced by every task)

| PG pattern | MySQL replacement |
|---|---|
| `drizzle-orm/pg-core`, `postgres`, `drizzle-orm/postgres-js` imports | `drizzle-orm/mysql-core`, `mysql2/promise`, `drizzle-orm/mysql2` |
| `insert(t).values(v).returning({...})` | `.$returningId()` → array of `{ id }`, then `select()` by id if more fields are needed |
| `update(t).set(v).where(...).returning({...})` / `delete(...).returning({...})` | run the write, then re-select by primary key **inside the same transaction** |
| `count(*)::int` | `count(*)` (mysql2 returns JS numbers for in-range BIGINT) |
| `count(*) filter (where COND)` | `sum(case when COND then 1 else 0 end)`; keep existing `coalesce(..., 0)` wrapping where the PG code already had it |
| `(${col} AT TIME ZONE 'Asia/Shanghai')::date::text` | `cast(date(${col}) as char)` — with session tz `+08:00` and TIMESTAMP columns, `date()` yields the Shanghai calendar date |
| `(${param}::timestamp AT TIME ZONE 'Asia/Shanghai')` as a comparison bound | drop the cast; pass the naive `'YYYY-MM-DD HH:mm:ss'` string computed app-side (dayjs, Asia/Shanghai); session tz makes the comparison identical |
| `${today}::date`, `${x}::int` casts on params | drop the cast (string params implicitly cast against date/int columns) |
| `order by x asc nulls last` | `.orderBy(sql`case when ${x} is null then 1 else 0 end asc`, ...rest)` |
| `.onConflictDoNothing()` | pre-select existing keys, filter the values array app-side, plain insert (no `ignore()` — it would swallow non-duplicate errors) |
| `.where(sql\`...\`)` on an index (partial index) | remove; see schema task for the per-index replacement |
| `pg` error `23505` / "duplicate key value violates unique constraint" | mysql2 `errno === 1062` / `code === 'ER_DUP_ENTRY'` / message includes "Duplicate entry" |

`.returning()` in **test files**: fixtures know all values — pass an explicit `id: crypto.randomUUID()` (or a fixed literal) in `.values({...})` and construct the expected return object directly. No re-select needed.

## Review Focus

Failure modes the spec implies but which are easiest to get silently wrong:

1. **Shanghai/UTC boundary**: a task updated just before/after Shanghai midnight must land on the correct day for streak/week/month stats. — Pinned by existing `analysis` service tests (Task 11) plus `kanban` "today" tests (Task 9). If any test asserts on UTC-shifted dates, fix the *test expectation derivation* only if it was wrong under PG too; otherwise suspect the SQL rewrite.
2. **Case sensitivity of identifiers**: registering `Alice` while `alice` exists must SUCCEED (PG exact-match semantics preserved by `utf8mb4_bin`); same-case duplicates must fail with a unique violation. — Pinned by a new test in Task 4.
3. **Pending-state exclusivity**: two pending invites for the same (team, invitee) must conflict; after `declined`/`accepted`, a new pending one must be allowed (generated-column NULL exemption). — Pinned by schema tests in Task 4 (verify they exist; add if not).
4. **Notification idempotency under MySQL**: a repeated due-scan the same day must insert zero rows and return `{dueSoon: 0, overdue: 0}`. — Pinned by existing due-scan tests rewritten in Task 10.
5. **FK cascade safety net**: deleting a team cascades to memberships/tasks; member removal nulls `assignee_id` without deleting tasks. — Pinned by existing schema tests (Task 4).

---

### Task 1: Docker infrastructure (MySQL service + initdb + env example)

**Files:**
- Modify: `docker-compose.yml`
- Modify: `docker/initdb/` (replace the two psql scripts with MySQL equivalents)
- Modify: `.env.example`

**Interfaces:**
- Produces: a healthy `mysql` compose service with `open_doing`, `open_doing_test`, `open_doing_e2e` databases, reachable at `localhost:${MYSQL_PORT:-3307}` as user `open-doing`/`open-doing`. Later tasks assume service name `mysql` and port 3307.

- [ ] **Step 1: Rewrite `docker-compose.yml`**

Service `mysql`, image `mysql:8.0`. Environment: `MYSQL_ROOT_PASSWORD: open-doing`, `MYSQL_USER: open-doing`, `MYSQL_PASSWORD: open-doing`, `MYSQL_DATABASE: open_doing`. Port mapping `"${MYSQL_PORT:-3307}:3306"` (keep the existing comment explaining the port-override convention; MySQL's 3306 is often locally occupied, same rationale as the old 5433). Command flags: `--character-set-server=utf8mb4 --collation-server=utf8mb4_0900_ai_ci`. Keep the initdb mount (`./docker/initdb:/docker-entrypoint-initdb.d:ro`) and volume (rename to `mysql_data`). Healthcheck: `mysqladmin ping -h 127.0.0.1 -uopen-doing -popen-doing` with the same interval/timeout/retries as before. Update the header comment (PostgreSQL → MySQL, same APFS/`pnpm dev` note).

- [ ] **Step 2: Replace initdb scripts**

Two `docker/initdb/*.sh` scripts, same one-shot semantics as now, using the `mysql` client:

```sh
mysql -u root -p"$MYSQL_ROOT_PASSWORD" -e "CREATE DATABASE IF NOT EXISTS open_doing_test CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;"
```

(one per extra database: `open_doing_test`, `open_doing_e2e`).

- [ ] **Step 3: Rewrite `.env.example`**

`DATABASE_URL=mysql://open-doing:open-doing@localhost:3307/open_doing`, `TEST_DATABASE_URL=mysql://open-doing:open-doing@localhost:3307/open_doing_test`. Rename the `POSTGRES_PORT` override note to `MYSQL_PORT` (default 3307). Keep `SESSION_SECRET`, `CRON_SECRET` untouched. Update the header comment (docker compose now starts MySQL).

- [ ] **Step 4: Verify compose comes up healthy**

Run: `docker compose down -v; docker compose up -d --wait; docker compose exec mysql mysql -uopen-doing -popen-doing -e "SHOW DATABASES" | grep open_doing`
Expected: exit 0, three `open_doing*` databases listed. (`down -v` is required: initdb only runs on an empty volume.)

- [ ] **Step 5: Commit**

```bash
git add docker-compose.yml docker/initdb .env.example
git commit -m "chore(db): replace postgres compose service with mysql 8.0"
```

---

### Task 2: Schema rewrite to mysql-core + migration regeneration

**Files:**
- Modify: `apps/web/src/server/db/schema.ts` (full rewrite, same table/index/constraint names)
- Modify: `apps/web/drizzle.config.ts`
- Delete: `apps/web/drizzle/0000_init.sql`, `0001_*.sql`, `0002_*.sql`, `0003_*.sql`, `meta/` (all old PG migration artifacts)
- Create: regenerated `apps/web/drizzle/0000_*.sql` + `meta/` (via drizzle-kit)

**Interfaces:**
- Produces: the same exported table objects (`users`, `teams`, `teamMemberships`, `teamInvites`, `teamJoinRequests`, `projects`, `tasks`, `subtasks`, `comments`, `notifications`) with identical names. New private helpers in `schema.ts`: `identifierVarchar(name)` (customType emitting `varchar(255) COLLATE utf8mb4_bin`), `uuidPk()`, `uuidRef(name)`. Later tasks import nothing new — table names and column property names are unchanged.

- [ ] **Step 1: Rewrite `schema.ts`**

Keep the file's header decision list (renumber/update wording for MySQL; all 9 decisions still hold). Structure per table:

- IDs: `const uuidPk = () => char("id", { length: 36 }).primaryKey().$defaultFn(() => crypto.randomUUID())`; FK columns `char(name, { length: 36 }).references(...)` — same `onDelete` actions as today (`cascade` everywhere, `set null` on `tasks.assigneeId`).
- Identifier/enum text columns via the `identifierVarchar` customType (DDL `varchar(255) COLLATE utf8mb4_bin`):

  ```ts
  import { customType } from "drizzle-orm/mysql-core";
  const identifierVarchar = (name: string) =>
    customType<{ data: string; driverData: string }>({
      dataType() {
        return "varchar(255) COLLATE utf8mb4_bin";
      },
    })(name);
  ```

  Applied to: `uid`, `username`, `name` (teams/projects), `slug` (both), `joinCode`, `language`, `role`, `status` (all three status tables), `spaceType`, `type` (notifications). Not-indexed bounded columns stay plain `varchar(255)` default collation: `passwordHash`, `title` (tasks/subtasks, use `varchar(500)`). Content columns stay `text`: `description` (projects/tasks), `content` (comments).
- Booleans: `boolean(...)` with the same defaults.
- Timestamps: `timestamp("created_at").notNull().defaultNow()` etc. (drop `withTimezone`; session tz governs).
- `tasks.dueDate`: `date("due_date", { mode: "string" })`.
- Unique/column indexes: same names, minus all `.where(...)` clauses (spec decision 4):
  - `notifications_user_task_type_unique`: plain unique on `(userId, taskId, type)` — NULL `taskId` rows exempt via MySQL NULL-distinct semantics.
  - `projects_team_id_slug_unique` / `projects_owner_id_slug_unique`: plain unique on the pair — NULL side exempt.
  - `team_invites` / `teamJoinRequests`: add generated column `pendingScope`:

    ```ts
    pendingScope: text("pending_scope").generatedAlwaysAs(
      sql`case when ${t.status} = 'pending' then 'pending' else null end`,
    ),
    ```

    and the unique index becomes `.on(t.teamId, t.inviteeId, t.pendingScope)` (same name as today). Generated column must be declared before use in the extra-config array.
  - Keep `check("projects_team_or_owner_check", sql`(${t.teamId} IS NOT NULL) <> (${t.ownerId} IS NOT NULL)`)` — drizzle mysql-core supports `check` (verified).
- `crypto` is a Node 18 global — no import needed.

- [ ] **Step 2: Update `drizzle.config.ts`**

`dialect: "mysql"`, default url `mysql://open-doing:open-doing@localhost:3307/open_doing`. Keep the header comment semantics (migrate only reads `DATABASE_URL`).

- [ ] **Step 3: Regenerate migrations**

Run: `rm -rf apps/web/drizzle/0000_*.sql apps/web/drizzle/000[1-3]_*.sql apps/web/drizzle/meta` then `set -a; source apps/web/.env.local; set +a; pnpm db:generate`
Expected: new `0000_*.sql` generated. Inspect it: must contain `CHAR(36)` ids, `COLLATE utf8mb4_bin` on identifier columns, `GENERATED ALWAYS AS` on `pending_scope`, no `WHERE` clauses on any index, the CHECK constraint present.

- [ ] **Step 4: Verify migration replays on the fresh MySQL volume**

Run: `set -a; source apps/web/.env.local; set +a; pnpm db:migrate`
Expected: exit 0 against the Task 1 volume. Re-run once more to confirm idempotence (drizzle migrations table tracks it; second run is a no-op).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/server/db/schema.ts apps/web/drizzle.config.ts apps/web/drizzle
git commit -m "feat(db): rewrite schema for mysql 8.0 and regenerate migrations"
```

---

### Task 3: Connection layer, error identification, test/e2e DB bootstrap

**Files:**
- Modify: `apps/web/src/server/db/client.ts`
- Modify: `apps/web/src/server/db/errors.ts:21-28` (the `isUniqueViolation` predicate)
- Modify: `apps/web/src/server/db/testing.ts`
- Modify: `apps/web/e2e/global-setup.ts` (same driver/migrator swap; keep its `assertE2EDatabaseUrl` guard)

**Interfaces:**
- Produces: `db`, `DbClient` (same export names/shapes; `DbClient` is now `MySqlDatabase<typeof schema>`-derived — callers are unaffected), `isUniqueViolation(error: unknown): boolean` (same signature), `setupTestDb(): Promise<DbClient>`, `closeTestDb()` (same signatures).

- [ ] **Step 1: Rewrite `client.ts`**

`mysql2/promise` pool via `mysql.createPool(url, { connectionLimit: 10, timezone: "+08:00" })`, then pin the SQL session timezone on every pooled connection (the `timezone` option only covers JS Date serialization, not `NOW()`/`CURRENT_TIMESTAMP`):

```ts
pool.on("connection", (conn) => {
  conn.query("SET time_zone = '+08:00'");
});
```

`drizzle(pool, { schema })` from `drizzle-orm/mysql2`. Keep all the existing guardrails verbatim: never fall back to `TEST_DATABASE_URL`, dev-only default URL (now `mysql://open-doing:open-doing@localhost:3307/open_doing`), production throws on missing var, `globalThis` caching. Update comments accordingly.

- [ ] **Step 2: Update `errors.ts`**

`errorChain` stays as-is (drizzle still wraps driver errors in `DrizzleQueryError.cause`). Rewrite `isUniqueViolation` to match mysql2: match `errno === 1062`, `code === "ER_DUP_ENTRY"`, or message containing `"Duplicate entry"`.

- [ ] **Step 3: Rewrite `testing.ts`**

`drizzle-orm/mysql2` + `mysql2` (pool `max: 1` → `connectionLimit: 1`) + `drizzle-orm/mysql2/migrator`. Truncate becomes:

```ts
await db.execute(sql`SET FOREIGN_KEY_CHECKS = 0`);
await db.execute(sql`TRUNCATE TABLE notifications, comments, ...`);
await db.execute(sql`SET FOREIGN_KEY_CHECKS = 1`);
```

(same table list as today; no `RESTART IDENTITY CASCADE` in MySQL). `closeTestDb` → `pool.end()`.

- [ ] **Step 4: Rewrite `e2e/global-setup.ts` DB plumbing**

Same swaps as `testing.ts` (driver, migrator, FK-checks-off truncate). Keep the URL assertion and TRUNCATE semantics unchanged otherwise.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/server/db/client.ts apps/web/src/server/db/errors.ts apps/web/src/server/db/testing.ts apps/web/e2e/global-setup.ts
git commit -m "feat(db): mysql2 connection layer, error codes, test bootstrap"
```

---

### Task 4: Test fixtures sweep + schema behavioral tests (first green gate)

**Files:**
- Modify: the 17 test files containing `.returning(` (find them: `grep -rl '\.returning(' apps/web/src --include='*.test.ts'`) — mechanical fixture rewrite per the Shared Rules test pattern
- Modify: `apps/web/src/server/db/schema.test.ts` — fixtures + two new behavioral tests
- Modify: `apps/web/src/server/db/seed.ts` fixtures are NOT here (seed is Task 12)

**Interfaces:**
- Consumes: `setupTestDb` from Task 3.
- Produces: green `schema.test.ts` proving the schema (case sensitivity, pending exclusivity, cascades, NULL exemption). Service tasks 5–11 rely on these schema semantics.

- [ ] **Step 1: Rewrite fixture `.returning()` call sites in all 17 test files**

Per the Shared Rules test pattern: explicit `id` in `.values()`, construct expected objects directly. Fixture values the tests already pass (uid, username, slug…) are unchanged.

- [ ] **Step 2: Add the case-sensitivity test to `schema.test.ts`**

```ts
it("用户名区分大小写（与 PG 精确匹配语义一致）", async () => {
  await createUser("alice");
  const second = await createUser("Alice"); // must NOT throw
  expect(second.username).toBe("Alice");
  await expect(createUser("alice")).rejects.toThrow(); // same-case still conflicts
});
```

Place it next to the existing username-unique test. (cjk-guard note: this test file already has a whitelist entry pattern — follow the file's existing convention for the Chinese test name.)

- [ ] **Step 3: Verify pending-invite exclusivity tests exist**

Check `schema.test.ts` covers: (a) second pending invite for same (team, invitee) violates; (b) after `declined`/`rescinded`, a new pending invite is allowed; (c) multiple rows with `taskId = NULL` and same `(userId, type)` in `notifications` are allowed. If any of the three is missing, add it in the same style; if all exist, no change.

- [ ] **Step 4: Run the schema test — first green gate**

Run: `set -a; source apps/web/.env.local; set +a; pnpm vitest run apps/web/src/server/db/schema.test.ts`
Expected: PASS (validates schema DDL, generated columns, truncate strategy, case sensitivity, cascades in one shot).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src
git commit -m "test(db): rewrite fixtures for mysql and pin collation semantics"
```

---

### Task 5: auth + users services

**Files:**
- Modify: `apps/web/src/features/auth/service.ts` (1 `.returning()` insert)
- Modify: `apps/web/src/features/users/service.ts` (2 `.returning()` sites)
- Test: the corresponding `service.test.ts` files (already fixture-rewritten in Task 4)

**Interfaces:**
- Consumes: schema (Task 2), `db`/`isUniqueViolation` (Task 3).
- Produces: unchanged public function signatures.

- [ ] **Step 1: Run the feature tests, confirm the expected failure**

Run: `set -a; source apps/web/.env.local; set +a; pnpm vitest run apps/web/src/features/auth apps/web/src/features/users`
Expected: FAIL (`.returning is not a function` or pg-flavored errors).

- [ ] **Step 2: Rewrite the 3 sites per the Shared Rules**

Insert sites → `.$returningId()` + select by id. Update sites → write then re-select by primary key inside the existing transaction. No raw SQL in these two files.

- [ ] **Step 3: Re-run the feature tests**

Run: same command as Step 1.
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/features/auth apps/web/src/features/users
git commit -m "refactor(auth,users): rewrite write paths for mysql dialect"
```

---

### Task 6: teams + teams/joins + teams/invites services

**Files:**
- Modify: `apps/web/src/features/teams/service.ts` (2 `.returning()`)
- Modify: `apps/web/src/features/teams/joins/service.ts` (5)
- Modify: `apps/web/src/features/teams/invites/service.ts` (3 `.returning()` + 1 raw-SQL site at line ~319: `(select count(*)::int from ${teamMemberships} ...)` → drop `::int`)
- Test: the three domains' `service.test.ts`

**Interfaces:** Consumes Tasks 2–4. Produces: unchanged signatures. (The generated-column pending-exclusivity behavior is exercised here through invite/join flows.)

- [ ] **Step 1: Run the three domains' tests** — Expected: FAIL (dialect errors).
- [ ] **Step 2: Rewrite the 10 `.returning()` sites + drop `::int` in the memberCount subquery** per the Shared Rules.
- [ ] **Step 3: Re-run the three domains' tests** — Expected: PASS.
- [ ] **Step 4: Commit** — `git commit -m "refactor(teams): rewrite write paths and member count for mysql dialect"`

---

### Task 7: projects + personal/projects services (+ spec decision 7 service assertion)

**Files:**
- Modify: `apps/web/src/features/projects/service.ts` (3 `.returning()`)
- Modify: `apps/web/src/features/personal/projects/service.ts` (3 `.returning()`)
- Test: both domains' `service.test.ts`

**Interfaces:** Produces: unchanged signatures, plus a new internal invariant assertion (below).

- [ ] **Step 1: Run both domains' tests** — Expected: FAIL.
- [ ] **Step 2: Rewrite the 6 `.returning()` sites** per the Shared Rules.
- [ ] **Step 3: Add the team/owner exclusivity assertion (spec decision 7)**

In every project-creation path in both services (and any path that could flip `teamId`/`ownerId`), assert before insert:

```ts
if ((teamId == null) === (ownerId == null)) {
  throw new Error("project must belong to exactly one of team / owner");
}
```

Plain `Error` is deliberate: this invariant is unreachable through the UI/actions, so it must NOT get an i18n key (spec decision 7; mirrors the existing "app-layer asserts personal assignee" precedent).

- [ ] **Step 4: Re-run both domains' tests** — Expected: PASS.
- [ ] **Step 5: Commit** — `git commit -m "refactor(projects): mysql write paths and app-layer exclusivity assert"`

---

### Task 8: tasks + personal/tasks services

**Files:**
- Modify: `apps/web/src/features/tasks/service.ts` (8 `.returning()`)
- Modify: `apps/web/src/features/personal/tasks/service.ts` (8 `.returning()`)
- Test: both domains' `service.test.ts`

**Interfaces:** Produces: unchanged signatures.

- [ ] **Step 1: Run both domains' tests** — Expected: FAIL.
- [ ] **Step 2: Rewrite the 16 `.returning()` sites** per the Shared Rules (subtask toggles, comment creates, task updates — most are insert/update + re-select inside existing transactions).
- [ ] **Step 3: Re-run both domains' tests** — Expected: PASS (overdue/due-soon semantics come from `today` props, not SQL — no raw-SQL changes expected here; verify with a grep that neither file contains `sql\`` — if it does, apply the Shared Rules).
- [ ] **Step 4: Commit** — `git commit -m "refactor(tasks): rewrite write paths for mysql dialect"`

---

### Task 9: kanban service

**Files:**
- Modify: `apps/web/src/features/kanban/service.ts` (1 `.returning()`; raw SQL at lines ~155, ~261, ~450-455, ~477-538, ~661-708)
- Test: `apps/web/src/features/kanban/service.test.ts`

**Interfaces:** Produces: unchanged signatures.

- [ ] **Step 1: Run the kanban tests** — Expected: FAIL.
- [ ] **Step 2: Rewrite per the Shared Rules**

- `count(*)::int` sites (~155, ~261) → `count(*)`.
- `subtaskTotal`/`subtaskDone` blocks (4 occurrences, ~477-538, ~694-708): `count(*)::int` → `count(*)`; `count(*) filter (where ${subtasks.completed})` → `sum(case when ${subtasks.completed} then 1 else 0 end)`; keep the existing `coalesce(..., 0)` wrappers and `.as("...")` aliases exactly.
- `recentStart` helper (~450): `sql\`((${today}::date - 6)::timestamp AT TIME ZONE 'Asia/Shanghai')\`` → compute the boundary app-side: `sql\`${sixDaysAgoStart}\`` where `sixDaysAgoStart` is the `'YYYY-MM-DD 00:00:00'` string for (today − 6 days) in Asia/Shanghai (derive from the `today` param with dayjs; do NOT use `new Date()` — date semantics rule).
- Ordering (~455): `sql\`${tasks.dueDate} asc nulls last\`` → `sql\`case when ${tasks.dueDate} is null then 1 else 0 end asc\`` as the first `orderBy` arg, keeping `desc(tasks.createdAt)` second.
- Status counts (~661-665): `count(*) filter (where COND)` → `sum(case when COND then 1 else 0 end)`.

- [ ] **Step 3: Re-run the kanban tests** — Expected: PASS (these tests pin the "today" boundary behavior — Review Focus 1).
- [ ] **Step 4: Commit** — `git commit -m "refactor(kanban): rewrite aggregates and ordering for mysql dialect"`

---

### Task 10: calendar + notifications (queries, due-scan)

**Files:**
- Modify: `apps/web/src/features/calendar/service.ts:260,273` (`count(*)::int`)
- Modify: `apps/web/src/features/notifications/queries.ts` (2 `.returning()`, 1 `count(*)::int` at line ~83)
- Modify: `apps/web/src/features/notifications/due-scan.ts:116` (`.onConflictDoNothing().returning(...)`)
- Test: the three modules' tests

**Interfaces:** Produces: unchanged signatures — `scanDueNotifications` still returns `{ dueSoon: number, overdue: number }` counting **newly inserted** rows only.

- [ ] **Step 1: Run the three modules' tests** — Expected: FAIL.
- [ ] **Step 2: Calendar + queries**: drop the `::int` casts; rewrite the 2 `.returning()` sites per the Shared Rules.
- [ ] **Step 3: due-scan idempotency rewrite** (spec Shared Rules, no `ignore()`):

Before the insert, deduplicate app-side: select existing triples `select({ userId, taskId, type }).from(notifications).where(and(inArray(notifications.taskId, taskIds), inArray(notifications.type, ["task_due_soon", "task_overdue"])))`, build a `Set` of `` `${userId}:${taskId}:${type}` ``, filter `values` against it. Plain insert (no `.returning()`); count `dueSoon`/`overdue` from the **filtered** array. If the filtered array is empty, return `{ dueSoon: 0, overdue: 0 }` without touching the DB.

- [ ] **Step 4: Re-run the three modules' tests** — Expected: PASS (Review Focus 4: repeated-scan test must show zero duplicates).
- [ ] **Step 5: Commit** — `git commit -m "refactor(notifications): mysql idempotent insert for due scan"`

---

### Task 11: dashboard (my-tasks, team-overview) + analysis services

**Files:**
- Modify: `apps/web/src/features/dashboard/my-tasks/service.ts` (1 `.returning()`; raw SQL ~42-65, ~151-185)
- Modify: `apps/web/src/features/dashboard/team-overview/service.ts` (raw SQL ~130-151, `nulls last` at ~158)
- Modify: `apps/web/src/features/analysis/service.ts` (raw SQL ~134-137, ~184-231, ~307-351, ~457-477)
- Test: the three modules' tests

**Interfaces:** Produces: unchanged signatures.

- [ ] **Step 1: Run the three modules' tests** — Expected: FAIL.
- [ ] **Step 2: my-tasks + team-overview**

`count(*) filter (where COND)` blocks → `sum(case when COND then 1 else 0 end)` (keep `coalesce` wrappers and `.as()` aliases); `count(*)::int` → `count(*)`; `${today}::date` / `${tomorrow}::date` → drop casts; `${weekStart}::timestamp AT TIME ZONE 'Asia/Shanghai'` → plain `${weekStart}` param; `sql\`${tasks.dueDate} asc nulls last\`` → `case when ... is null then 1 else 0 end asc`. The 1 `.returning()` per Shared Rules.

- [ ] **Step 3: analysis**

- `completedDay` / `createdDay` (~134, ~137): `sql<string>\`cast(date(${tasks.updatedAt}) as char)\`` and the `createdAt` twin (session tz makes `date()` the Shanghai day — spec decision 2).
- Window comparisons (~184-196, ~223-231, ~327-328): keep structure, drop `::int`.
- Week/zombie cutoffs (~316, ~351): `${weekStart}::timestamp AT TIME ZONE 'Asia/Shanghai'` → plain param, same for `zombieCutoff` — confirm at the call sites that these params are already naive Shanghai-local `'YYYY-MM-DD HH:mm:ss'` strings computed by dayjs (`today.ts` conventions); if any is derived differently, compute it app-side the same way.
- Stat card `FILTER` block (~473-477) → `sum(case when ...)`; note `${tasks.dueDate}::text` in the on-time comparison → drop the cast (`completedDay` is already a `'YYYY-MM-DD'` char string, matching the date column's string form lexicographically).

- [ ] **Step 4: Re-run the three modules' tests** — Expected: PASS (these pin the week/month windows — Review Focus 1).
- [ ] **Step 5: Commit** — `git commit -m "refactor(dashboard,analysis): rewrite aggregates and windows for mysql dialect"`

---

### Task 12: seed script

**Files:**
- Modify: `apps/web/src/server/db/seed.ts` (imports at ~27-31; 5 `.returning()` sites at ~538, ~552, ~576, ~590, ~643)

**Interfaces:** Consumes: schema (Task 2), connection pattern (Task 3). Produces: idempotent seed with identical sample data.

- [ ] **Step 1: Swap imports** — `drizzle-orm/mysql2` + `mysql2/promise` + `drizzle-orm/mysql2/migrator`; single connection via `mysql.createConnection` (pool with `connectionLimit: 1` is fine); keep the same `DATABASE_URL`-only guard and the session-tz `SET` from Task 3.
- [ ] **Step 2: Rewrite the 5 `.returning()` sites** — these are inserts whose generated `id` is needed downstream: use `.$returningId()` and take `[0].id`. All other returned fields come from values the script just constructed.
- [ ] **Step 3: Verify on a fresh database**

Run: `docker compose exec mysql mysql -uopen-doing -popen-doing -e "DROP DATABASE open_doing; CREATE DATABASE open_doing CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;"` then `set -a; source apps/web/.env.local; set +a; pnpm db:migrate && pnpm db:seed`
Expected: seed completes, prints the success message; run `pnpm db:seed` again → prints "已初始化" skip message (idempotent guard intact).

- [ ] **Step 4: Commit** — `git commit -m "refactor(db): port seed script to mysql"`

---

### Task 13: e2e guard script + full verification gates

**Files:**
- Modify: `apps/web/scripts/e2e-with-db-guard.sh` (psql → mysql throughout)
- Modify: `AGENTS.md`, `docs/ARCHITECTURE.md` (PostgreSQL → MySQL wording; keep the design doc's historical mention as-is)

**Interfaces:** Consumes: everything above. Produces: all repo gates green.

- [ ] **Step 1: Port the guard script**

`psql_exec` → `mysql_exec` (host client `mysql -h ... -P ... -u ... -p...` → docker `docker compose exec -T mysql mysql -u... -p...`; keep the stdin `</dev/null` note). Table listing: `SELECT table_name FROM information_schema.tables WHERE table_schema = DATABASE() ORDER BY table_name`. Row counts: `SELECT count(*) FROM \`$table\`` (backticks). Env defaults: `MYSQL_PORT:-3307`. Service name in the docker fallback: `mysql`. Update the header comments (same guard purpose, same dbs).

- [ ] **Step 2: Residue grep — zero PG remnants**

Run: `grep -rnE 'pg-core|postgres-js|from "postgres"|drizzle-orm/postgres|AT TIME ZONE|::int|::date|::timestamp|nulls last|onConflictDo|\.returning\(|23505|NULLS LAST' apps/web/src apps/web/scripts apps/web/e2e docker-compose.yml`
Expected: no matches outside `node_modules`. (Comments mentioning PostgreSQL historically are acceptable only in the design/spec docs, not in code.)

- [ ] **Step 3: Full gates**

Run in order (each must pass before the next):
1. `set -a; source apps/web/.env.local; set +a; pnpm lint`
2. `pnpm --filter @open-doing/web exec next typegen && pnpm typecheck`
3. `set -a; source apps/web/.env.local; set +a; pnpm test`
Expected: all green.

- [ ] **Step 4: e2e**

Stop the dev server first (Next 16 dev-lock). Run: `pnpm --filter @open-doing/web exec playwright install chromium` (if needed), then `pnpm --filter @open-doing/web test:e2e`.
Expected: all flows pass; the guard prints both snapshots unchanged. Restart the dev server afterwards.

- [ ] **Step 5: Docs sync**

`AGENTS.md`: stack line, db commands section (`docker compose` note, connection-string examples, port 3307), security section wording. `docs/ARCHITECTURE.md`: the 6 PostgreSQL mentions. Do not touch frozen contracts; the spec/design docs keep their historical references.

- [ ] **Step 6: Commit**

```bash
git add apps/web/scripts/e2e-with-db-guard.sh AGENTS.md docs/ARCHITECTURE.md
git commit -m "docs(db): sync guides and e2e guard to mysql stack"
```
