<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# @open-doing/web

The only application in the monorepo: pages + Server Actions + Route Handlers + DB access. For repo-wide conventions, commands, and the permission/i18n/date rules, read the root `AGENTS.md` first — this file covers only what is specific to this package.

## Quick facts

- Next.js App Router, React Server Components by default; mutations go through Server Actions (no public REST API — Route Handlers exist only for cron).
- PostgreSQL 16 via Drizzle ORM (`pg-core`); schema at `src/server/db/schema.ts`, migrations in `drizzle/`. Primary keys are native `uuid`s with `gen_random_uuid()`; timestamps are `timestamptz` (absolute instants, no custom timestamp type).
- UI is the vendored shadcn/ui set (`src/components/ui/shadcn/`, Radix + cva) + Tailwind 4 (preflight enabled in `globals.css`); there is no runtime theme — colors come from design tokens in `src/app/tokens.css` (1:1 with the prototypes), and antd must not be reintroduced (a guard test pins this).
- All user-visible copy lives in `src/i18n/messages/{zh,en}.json` (next-intl). Hardcoded CJK strings fail the cjk-guard test; new features must ship both locales.
- "Today" is computed in Asia/Shanghai (`src/lib/today.ts`); RSCs pass `today` down as a prop — never read the local timezone in components.

## Directory map (`src/`)

```
app/            Routes: (auth)/, (dashboard)/, api/cron/. (dashboard) is guarded by requireUser()
features/       Domain modules: auth, users, teams, projects, tasks, kanban,
                calendar, analysis, notifications, personal, dashboard.
                Each has actions.ts (Server Actions) / service.ts (data access +
                business rules) / components/
components/     ui/ shared components (ConfirmModal, StatCard, … + vendored shadcn/
                primitives in ui/shadcn/), layout/ frame layout (AppShell etc.)
hooks/          Generic client hooks
lib/            Pure utilities (slug, today, domain-failure, ...)
server/         db client, auth/session, cron entry points
i18n/           server.ts (request locale), messages/{zh,en}.json
```

## Env is resolved from this directory

Next.js resolves `.env.local` from `apps/web`, not the repo root. Required variables:

```
DATABASE_URL=...
SESSION_SECRET=...
CRON_SECRET=...
```

Gotcha: vitest and drizzle-kit do NOT read `.env.local` — export the variables in the shell before running tests or migrations.

## App-scoped commands (from repo root)

```bash
pnpm dev                                        # dev server, http://localhost:3000
pnpm --filter @open-doing/web exec next typegen # generate route types BEFORE pnpm typecheck on a clean checkout
pnpm --filter @open-doing/web db:generate      # generate a migration after editing schema.ts
pnpm --filter @open-doing/web db:migrate
pnpm --filter @open-doing/web db:seed          # idempotent sample data, development only
pnpm --filter @open-doing/web test:e2e         # Playwright e2e, port 3100, separate DB open_doing_e2e
pnpm --filter @open-doing/web exec playwright install chromium   # first e2e run only
```

## Writing code here

- Server Actions: validate input → check permissions (every action authorizes itself; centralized helpers in `features/teams`) → call service → return `ActionResult<T>` with field errors.
- Business rules and data access live in feature `service.ts`, never in pages.
- Radix-based interactive components (Dialog, AlertDialog, DropdownMenu, Popover, Select, Sheet) only inside `"use client"` components; pages pass serializable props. Optimistic updates use the "sync props → state during render" pattern with `router.refresh()`. `ConfirmModal` does not auto-close on confirm — the consumer closes in its success branch; `loading` disables Esc and the cancel button.
- Domain errors: service throws `<X>Error(zh fallback, field, { key, params })`; never display the constructor's Chinese directly — it is translated per request locale.
- Routes use slugs for teams/projects and opaque IDs for task details. `personal` is a reserved spaceRef.
