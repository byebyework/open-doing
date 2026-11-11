# AGENTS.md

This file provides guidance to AI coding agents (Claude Code, CodeBuddy, etc.) when working with code in this repository.

## Project Overview

Open Doing: a personal + team task and project management system. Monolithic Next.js (App Router, React, Turbopack) + PostgreSQL 16 + Drizzle ORM + vendored shadcn/ui (Radix primitives) + Tailwind CSS 4. The UI is fully localized (zh/en via next-intl, no URL locale prefix). The root route `/` is a marketing landing page (`features/landing`) for anonymous visitors — product showcase with Motion-driven effects, full zh/en copy, anonymous locale preference via the `od_locale` cookie; logged-in users are redirected server-side to their personal dashboard. Pages are RSC by default; write operations go through Server Actions. After login, the app is organized by spaces: the personal space and each team space share the same Dashboard / Kanban / Calendar / Analysis / Settings module navigation, with routes unified as `/space/{spaceRef}/{module}` (`spaceRef` = `personal` or a team slug).

Authoritative docs (read the relevant section before changing code):

- `docs/2026-10-21-open-doing-v1-design.md` — the product "what and why"
- `docs/ARCHITECTURE.md` — "how it's built"
- `docs/prototypes/` — HTML prototypes; the reference baseline for UI visuals and copy (frozen for this round; do not modify alongside implementation)

Frozen contracts (e.g. `AppShell`, the import relationships in `(dashboard)/layout.tsx`) must not be modified.

`apps/web/AGENTS.md`: Next.js has breaking changes relative to typical training data. Before writing Next-related code, read the relevant guides in `apps/web/node_modules/next/dist/docs/` and watch for deprecation notices.

## Build and Test Commands (repo root)

```bash
docker compose up -d --wait   # Start PostgreSQL 16 (dev db open_doing + test db open_doing_test + e2e db open_doing_e2e, host port 5433)
pnpm install
cp .env.example apps/web/.env.local   # Next.js resolves env from apps/web, not the repo root
pnpm dev                      # web app, http://localhost:3000
pnpm build
pnpm lint                     # all packages
pnpm typecheck                # see ordering requirement below
pnpm test                     # all Vitest tests
pnpm vitest run apps/web/src/lib/slug.test.ts   # a single test file
pnpm db:generate              # generate a migration after changing schema.ts
pnpm db:migrate
pnpm db:seed                  # idempotent sample data (login 林夏 / seed-password, uid doing_x7k2m9)
pnpm --filter @open-doing/web test:e2e          # Playwright e2e (port 3100, separate db open_doing_e2e)
pnpm --filter @open-doing/web test:e2e -- flows/04-cron-reminder.spec.ts   # a single e2e flow
```

Environment variable gotchas:

- **vitest and drizzle-kit do NOT read `apps/web/.env.local`**. Run `set -a; source apps/web/.env.local; set +a` first (or export the vars another way) before running tests/migrations, otherwise database tests silently skip.
- The database pointed to by `TEST_DATABASE_URL` is **wiped by tests**; it must be a different database from the dev `DATABASE_URL`.
- Typecheck ordering: on a clean checkout, run `pnpm build` (or `pnpm --filter @open-doing/web exec next typegen`) before `pnpm typecheck` — Next.js route types are generated at build time.
- Before running e2e for the first time: `pnpm --filter @open-doing/web exec playwright install chromium`.
- **Full dev-DB reset after regenerating migrations**: run `DROP SCHEMA public CASCADE; DROP SCHEMA IF EXISTS drizzle CASCADE;` before `pnpm db:migrate`. Drizzle-kit records applied migrations in its own `drizzle` schema; dropping only `public` leaves the journal behind, so `db:migrate` silently skips table creation.

## Architecture

### Monorepo (pnpm workspaces)

- `apps/web` (`@open-doing/web`) — the only app: pages + Server Actions + Route Handlers + DB access.
- `packages/types` (`@open-doing/types`) — **serializable types and pure functions** shared between frontend and backend (e.g. `getTaskProgress`, `isOverdue`). Rules: no React dependency, no database access, no IO. Drizzle row types stay inside the web package; when crossing the boundary, map them to domain models in the features layer.

### Feature domain modules (`apps/web/src/features/`)

Self-contained by domain: auth / users / teams / projects / tasks / kanban / calendar / analysis / notifications / personal / dashboard / landing. Each domain has:

- `actions.ts` — Server Actions: validate input → check permissions → call service → return `ActionResult<T>` (`{ ok: true, data }` or `{ ok: false, errors: { form?, <field>?: string } }`). Field errors are mapped back to the corresponding form fields by client forms.
- `service.ts` — data access and business rules (e.g. "a member cannot edit others' tasks"); never scattered inside pages.
- `components/` — domain components; cross-domain generic components go in `src/components/ui`.

### Authentication (better-auth)

- Authentication is **better-auth** (`apps/web/src/features/auth/server.ts`), not a hand-rolled JWT. Sessions are database rows (`sessions` table, 30-day expiry) and password hashes live in `accounts.password`; the `users` table is better-auth's `user` model (`name` / `email` / `emailVerified` / `image` / `displayUsername`). The domain layer still exposes `nickname`, mapped from better-auth's `name`.
- **Email is required at registration** (NOT NULL, globally unique, lowercased). Registration is closed-beta: registration codes (`registration_codes`, `used_count < max_uses`) are consumed atomically in better-auth database/request hooks, which also generate the `doing_xxxx` uid and the fallback display name.
- Login is by username (username plugin; case-sensitive). `changePasswordAction` calls `changePassword` with `revokeOtherSessions: true`: **all** sessions are deleted and a new session/cookie is issued for the current device, so the user stays signed in while other devices are signed out. The action's re-render still carries the old cookie, so the current device routes through `/login` and lands on the personal dashboard.
- Env: `BETTER_AUTH_SECRET` signs sessions (production throws when missing); `BETTER_AUTH_URL` is optional and inferred from the request. Playwright injects `BETTER_AUTH_URL=http://localhost:3100` plus a test-only secret.
- Security-sensitive auth flows must keep `nextCookies()` as the last plugin; it is what writes session cookies from Server Actions.

### Server/client boundary

- Pages are RSC by default: the server fetches data per session user, without going through a public API; the `(dashboard)` routes uniformly redirect to `/login` via `requireUser()`.
- Radix-based interactive components (Dialog, AlertDialog, DropdownMenu, Popover, Select, Sheet, etc.) may only be used inside `"use client"` components; pages push interactions down into client wrappers and pass serializable data via props. Components with optimistic updates use the "sync props → state during render" pattern (`if (props !== synced) { ... }`) to integrate with `router.refresh()`.

### Permission model (must follow)

- **Every Server Action performs its own authorization** — never trust that a page merely hides the entry point; permission decisions are centralized in `features/teams` (`canEditTask({ role, actorId, assigneeId })`, etc.) and each feature's service.
- Data queries carry visibility filters: team data requires membership; personal-space data (personal tasks / personal projects) is visible only to the owner.
- Comment permission and content-edit permission are separate; members may comment and view details, but cannot edit others' tasks.

### UI conventions (shadcn/ui + Tailwind 4)

- Components come from the **vendored shadcn/ui set** in `apps/web/src/components/ui/shadcn/` (Radix primitives + cva + Tailwind; each file's header comment documents its adaptations) — do not build your own, and **do not reintroduce antd** (a guard test in `components/ui/AtomsShadcn.test.tsx` fails on any `from "antd"` import and on hardcoded sr-only copy). Project-level composites (ConfirmModal, StatCard, EmptyState, …) live in `src/components/ui/`; Tailwind is only for layout/spacing/fine-tuning.
- `globals.css` imports Tailwind 4's theme + **preflight** + utilities layers (preflight was re-enabled once antd was removed); do not override shadcn/Radix internals with global selectors.
- **All UI animation goes through Motion (`motion/react`)** — no CSS keyframes for UI motion (the old `app/motion.css` was deleted when the overlays were migrated). The vendored overlays (dialog, alert-dialog, popover, dropdown-menu, select, sheet) share an exit-hold bridge in `components/ui/overlay-motion.ts` (`createHeldOverlayRoot`): `onOpenChange` fires immediately, but the exiting content stays mounted for 150–300ms so the exit animation can play (dialog/alert-dialog/sheet hold the Root open; the pop family closes the Root immediately and keeps Content mounted via `forceMount`). Because the exiting overlay is still in the DOM, destructive/submit handlers must gate on the dialog state (`!open || loading`) to avoid double-fire — see `ConfirmModal` and the form dialogs. Reduced motion: `MotionConfig reducedMotion="user"` in `providers.tsx` gates transform/layout animations; MotionValue-driven styles need an explicit `useReducedMotion()` gate.
- There is **no runtime theme** (`theme.ts` is gone): design tokens originate from `docs/prototypes/assets/design-tokens.css` (brand purple `#7d2ae8`, gradient `#7d2ae8→#00c4cc`); the runtime copy is `apps/web/src/app/tokens.css` (imported by `globals.css`). Variable names and values must stay 1:1 with the prototypes — when changing tokens, update both places. In components use token CSS variables (`var(--ink-900)`), never literal hex values. Build new UI against the same-named page in `docs/prototypes/`.
- Global toasts are sonner (Toaster mounted once in the root `providers.tsx`; shadow/icons aligned to the prototype `.toast` spec). `ConfirmModal` does **not** auto-close on confirm (Radix Action's default close is prevented; the consumer closes in its success branch, so failures keep the dialog and its input), and while `loading` is set, Esc and the cancel button are disabled — antd `confirmLoading` semantics.

### Internationalization (i18n, mandatory)

- All UI copy goes through next-intl (no URL locale prefix): message catalogs live in `apps/web/src/i18n/messages/{zh,en}.json`; request-level locale resolution is in `apps/web/src/i18n/server.ts`.
- **All user-visible copy must go into the message catalogs — hardcoding is forbidden**: `src/i18n/cjk-guard.test.ts` scans `src` and `e2e` and fails on any CJK character (after stripping comments), listing file:line. Non-copy Chinese requires a per-entry whitelist entry with a justification inside the test itself.
- **New features (components/forms/errors/notifications) must ship both zh and en entries**: `src/i18n/messages-parity.test.ts` enforces identical key structure between the two catalogs.
- Server-side error copy: the service layer throws `new <X>Error(zh fallback, field, { key, params })`; the action layer's `toFailure` routes through `standardFailuresForRequest()` (which picks a translator by request locale) and translates via `failures.custom("<domain ns>.<key>", params)` onto `field ?? "form"` (`lib/domain-failure.ts` also provides the pure-function variant `domainFailureWith` with an injectable translator). Domain error keys go in the corresponding domain namespace; generic failures (403, rate limiting, etc.) go in the `errors` namespace. The Chinese in constructor args is only a fallback and must never be displayed directly.
- Notification template bodies contain `<b>` bold markers, parsed into segments by `parseBoldSegments` in `features/notifications/components/notification-format.ts`; keep zh/en in sync when changing templates.
- Language preference: for logged-in users, `users.language` is the single source of truth (switching takes effect immediately across devices); for anonymous users, the `od_locale` cookie; both fall back to zh. Switch UIs: the landing nav (anonymous; `setAnonymousLocaleAction` in `features/landing/actions.ts` writes only the cookie) and personal settings (`updateLanguageAction` in `users/actions.ts` writes both DB and cookie).
- dayjs locale and `html lang` are switched per request by the root Providers and root layout (`LOCALE_HTML_LANG`); client-side copy such as the success toast after a language switch renders only after the RSC refresh delivers the new message catalog.

### Date semantics

"Today" is always computed in Asia/Shanghai (`apps/web/src/lib/today.ts`, same convention as the notification cron). RSCs pass `today` as a prop to client components for overdue/due-soon checks, guaranteeing server/client render consistency; do not use the local timezone to get the current date inside components. `due_date` is a PostgreSQL `date` type.

### Database

- Schema: `apps/web/src/server/db/schema.ts` (Drizzle `pg-core`); migrations in `apps/web/drizzle/` (replayable on an empty database). Tables use native `uuid` primary keys with `gen_random_uuid()`; timestamps are `timestamptz` (absolute instants, no custom timestamp type). Slugs locate teams/projects; task details use opaque IDs.
- Auth tables: `users` doubles as better-auth's user model (`name` carries the display name); `sessions` / `accounts` / `verifications` are better-auth's core tables. There is no `users.password_hash` / `users.nickname` column — credentials live in `accounts.password` and `email` is NOT NULL.
- Cascading deletes rely on foreign keys `ON DELETE CASCADE` as the safety net; removing a member only deletes the membership and nulls the tasks' `assignee_id` — it does not delete tasks.
- `server/db/testing.ts` replays migrations + truncates the test database.

## Code Style Guidelines

- TypeScript throughout; match the surrounding style of the file you are editing.
- Keep domain logic in feature `service.ts` files; do not leak it into pages or client components.
- Cross-boundary data must be serializable — map Drizzle row types to domain models at the features layer.
- Never hardcode user-visible copy (see i18n section); never fetch dates from the local timezone (see Date semantics).
- Prefer the vendored shadcn/ui components over custom-built ones; Tailwind only for layout/spacing/fine-tuning.

## Testing Instructions

- Unit/integration tests: Vitest, configured at the repo root. **Test files run serially** (`fileParallelism: false`) — multiple files share one test database and TRUNCATE each other; do not enable parallelism.
- Database tests require the local PostgreSQL 16 container (`docker compose up -d --wait`); they replay the Drizzle migrations and TRUNCATE the test database between tests.
- The test database (`TEST_DATABASE_URL`) is truncated between tests; it must never be the dev database.
- e2e tests: Playwright, port 3100, against the separate `open_doing_e2e` database. Install chromium first (`pnpm --filter @open-doing/web exec playwright install chromium`).
- Before `pnpm typecheck` on a clean checkout, generate route types via `pnpm build` or `pnpm --filter @open-doing/web exec next typegen`.

## Security Considerations

- **Authorize inside every Server Action independently.** Hiding a UI entry point is not access control.
- Apply visibility filters in every query: team data requires membership; personal-space data is owner-only.
- `POST /api/cron/due-scan` is authenticated by `CRON_SECRET` and designed to be idempotent — keep it that way.
- Never commit real credentials. Use `.env.local` (gitignored) for local secrets; `.env.example` documents required variables.
- Secrets such as `DATABASE_URL`, `TEST_DATABASE_URL`, `BETTER_AUTH_SECRET`, and `CRON_SECRET` must never appear in code, logs, or tests.
- Never point `TEST_DATABASE_URL` at the development database — tests wipe it.

## Commit and Pull Request Guidelines

Commit messages follow Conventional Commits:

```
<type>(<scope>): <subject>
```

- Common types: `feat`, `fix`, `refactor`, `test`, `docs`, `chore`. Use the scope that matches the touched domain (e.g. `feat(i18n): migrate tasks module`, `test(e2e): add english locale smoke flow`).
- Subject: English, lowercase start, imperative mood, no trailing period; keep it to one line. Use the body for context and rationale when needed.
- Examples from this repo: `fix(ui): align sonner toast shadow and icons with prototype`, `refactor(i18n): converge shared action fallback messages to error keys`.

- When shipping a new feature, include in the same change: zh + en message catalog entries, and updated tests (including the cjk-guard / messages-parity tests).
- Before opening a PR: run `pnpm lint`, `pnpm test`, e2e flows affected by the change, and `pnpm typecheck` (after generating route types).

## Deployment Notes

- The app is a single Next.js deployment (`apps/web`); PostgreSQL 16 is the only external service.
- Database schema changes are applied via Drizzle migrations (`pnpm db:generate` then `pnpm db:migrate`); migrations are replayable on an empty database.
- Env vars are resolved from `apps/web` (Next.js), not the repo root — configure production env accordingly.
- Sample/seed data (`pnpm db:seed`) is for development only; never run it against production.
