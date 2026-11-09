# Open Doing Architecture

Companion doc: [2026-10-21-open-doing-v1-design.md](./2026-10-21-open-doing-v1-design.md)

This document describes the target architecture and how the system is built. What the features are and why they exist is defined in the design document.

## 1. Overview

A monolithic web application (no microservices):

- **Next.js (App Router, React, Turbopack)** hosts pages, Server Actions, and Route Handlers in one app.
- **PostgreSQL 16** is the only persistent store; **Drizzle ORM** handles schema, migrations, and queries.
- Scheduled scans (due-soon/overdue notifications) run through a protected Route Handler triggered by an external cron — no separate worker process.
- No email sending, no third-party services; no external dependencies other than the database and cron.

```
Browser
  │  HTTP (RSC pages / Server Actions / Route Handlers)
  ▼
apps/web (Next.js)
  ├── app/            Routing layer: pages, actions, api
  ├── features/*/     Domain modules: business logic and data access
  └── server/         Infrastructure: db, auth, session
  │
  ▼
PostgreSQL 16 (Docker for local development)
```

## 2. Monorepo Layout

pnpm workspaces:

```
apps/
└── web/                 # @open-doing/web, the Next.js app
    └── src/
        ├── app/         # routing (see §5)
        ├── features/    # domain modules (see §4)
        ├── components/  # ui/ shared components, layout/ frame layout
        ├── hooks/       # generic client hooks
        ├── lib/         # pure utility functions
        └── server/      # db client, auth/session, cron entry points
packages/
└── types/               # @open-doing/types, domain types and pure computation shared across the boundary
```

- `@open-doing/types` holds only **serializable types and pure functions** (e.g. progress calculation); it must not depend on React, access the database, or do IO.
- Database row types (Drizzle infer) stay inside the web package; when data crosses the boundary, map it to the domain models of `@open-doing/types` in the features layer.
- The web package references internal packages via `workspace:*`; `transpilePackages` in `next.config.ts` already includes `@open-doing/types`.
- If a UI component library or a standalone API client is extracted later, extend the same way as `packages/ui` / `packages/api-client`.

## 3. Technology Decisions

| Aspect | Choice | Rationale |
|---|---|---|
| Framework | Next.js App Router | One app for pages + server logic; RSC reduces data-fetching boilerplate |
| Language | TypeScript (strict) | Shared types across frontend and backend |
| UI components | **shadcn/ui (vendored) on Radix primitives** | Accessible headless behavior (dialog, dropdown, select, alert…) styled with Tailwind; vendored under `components/ui/shadcn/` with per-file adaptation notes |
| Toasts | sonner | Single Toaster in root `providers.tsx`; position/shadow/icons aligned to the prototype `.toast` spec |
| Styling | **Tailwind CSS 4 (preflight enabled)** | theme + preflight + utilities layers; utilities handle layout/spacing/fine-tuning |
| Theme/locale | Design tokens in `tokens.css` (light only) + dayjs locale per request | No runtime theming (`theme.ts` removed); tokens stay 1:1 with the prototypes; locale switches next-intl + dayjs + `<html lang>` |
| Database | PostgreSQL 16 | Relational integrity, cascade deletes, unique constraints (username, UID) |
| ORM | Drizzle | Lightweight, close to SQL, good type inference, built-in migration tooling |
| Local database | Docker compose | Consistent environment, zero manual setup |
| Auth | Username + password; stateless HS256 signature via jose in an httpOnly cookie (`od_session`, sameSite lax, 30 days, payload `{ userId }`) + `@node-rs/argon2` (Argon2id) | No sessions table: no DB lookup on validation, no session cleanup job; Argon2id resists GPU cracking with fast native performance; signing key from `SESSION_SECRET` |
| Data mutations | Server Actions | Fits App Router forms / progressive enhancement |
| Scheduled jobs | Protected Route Handler + cron | No worker process, simple deployment |
| Package management | pnpm workspaces | Decided |

## 4. Domain Modules

Business code is organized by domain; each domain is self-contained with components / actions / data access:

```
features/
├── auth/       Register, login, logout, session
├── users/      User profile, lookup by UID (used for invites), reminder preferences and personal settings components
├── teams/      Teams, memberships, invites, roles and permission decisions
├── projects/   Project CRUD (project page header actions)
├── tasks/      Tasks, subtasks, comments, kanban status transitions
├── kanban/     Space-level Kanban: cross-project aggregation, filters, done convergence
├── calendar/   Space-level Calendar: month grid aggregated by due date, this-week / this-month due-soon lists
├── analysis/   Space-level Analysis: completion trends / throughput / member load / project health
├── personal/   Personal space: personal tasks (kanban/detail) and personal projects
├── dashboard/  Personal Dashboard (personal-dashboard / my-tasks) and team Dashboard (team-dashboard / team-overview)
└── notifications/ Notifications, read state, due-date scan
```

- **actions/**: Server Actions only validate input, check permissions, call domain logic, and return `ActionResult` (success or a failure object with field errors).
- **components/**: domain-specific components; reusable base components go in `components/ui`.
- Data access functions and business rules (e.g. "a member cannot edit others' tasks") are centralized in each feature's server-side modules, never scattered in pages. Pages (RSC) fetch and assemble data; client components only handle interaction.

### 4.1 UI Conventions (shadcn/ui + Tailwind 4)

- **The vendored shadcn/ui set is the component baseline**: dialogs, dropdowns, selects, popovers, tabs, etc. come from `components/ui/shadcn/` (Radix primitives + cva + Tailwind) — do not build your own; each vendored file's header comment documents its adaptations (e.g. next-themes removed, sr-only copy routed through next-intl). `components/ui/` additionally holds project-level composites (ConfirmModal, StatCard, EmptyState, UserAvatar, …). **antd must not be reintroduced** — a guard test (`AtomsShadcn.test.tsx`) fails on any `from "antd"` import or hardcoded sr-only copy.
- **Tailwind handles layout and fine-tuning**: page skeletons, spacing, flex/grid via Tailwind utilities; `globals.css` imports Tailwind 4's theme + preflight + utilities layers (preflight was re-enabled after the antd removal).
- **Client boundary**: Radix interactive components (Dialog, AlertDialog, DropdownMenu, Popover, Select, Sheet, etc.) may only be used in Client Components. Pages stay RSC for data fetching; interactions are pushed down into `"use client"` components that receive serializable data via props.
- **Root layout**: `providers.tsx` sets the request's dayjs locale and mounts the single sonner Toaster; there is no runtime theme — colors/spacing come from design tokens in `tokens.css`.
- Style conflict rule: prefer token CSS variables (`var(--ink-900)`) over literal hex values; Tailwind must not override shadcn/Radix component internals — never global selectors.
- Kanban drag-and-drop is implemented with `@dnd-kit/core` + `@dnd-kit/sortable` (cards are Tailwind-styled elements using design tokens).
- Confirm semantics: `ConfirmModal` wraps Radix AlertDialog; the confirm button's default close is prevented, so **the consumer closes in its success branch** (failures keep the dialog and its input; `loading` disables Esc and the cancel button — antd `confirmLoading` semantics).

## 5. Routing Structure

The app is unified as a space tree: `/space/{spaceRef}/{module}`, where `spaceRef` is `personal` or a team slug. Personal space exposes four modules — `dashboard / kanban / calendar / analysis`; team space adds a fifth, `settings` (displayed as 团队管理 / team management, route unchanged). Personal settings are not a space module: they live at the top-level `/settings` route, reached from the topbar user menu.

```
app/
├── (auth)/
│   ├── login/page.tsx
│   └── register/page.tsx
├── (dashboard)/                     # logged-in layout: sidebar + top bar (with notification badge)
│   ├── page.tsx                     # `/` → /space/personal/dashboard
│   ├── settings/page.tsx            # personal settings (system-level): profile, password, reminders, language, project ordering
│   ├── invites/page.tsx             # pending invites (accept/decline), not a space page
│   ├── teams/
│   │   ├── new/page.tsx             # create team, static page
│   │   └── join/page.tsx            # join by code, static page
│   └── space/
│       ├── personal/
│       │   ├── dashboard/page.tsx   # personal Dashboard: stat cards + "today" list (≤20)
│       │   ├── kanban/page.tsx      # personal Kanban: cross-project aggregation + ?project filter
│       │   ├── calendar/page.tsx    # personal Calendar: month view + this-week / this-month lists (?month)
│       │   ├── analysis/page.tsx    # personal Analysis: trends / backlog / on-time rate / project comparison (?range)
│       │   ├── projects/[projectSlug]/
│       │   │   └── page.tsx         # personal project page (list/kanban dual view, owner only)
│       │   └── tasks/[taskId]/page.tsx # personal task detail (incl. tasks in personal projects)
│       ├── [teamSlug]/
│       │   ├── dashboard/page.tsx   # team Dashboard: health + key milestones + member load
│       │   ├── kanban/page.tsx      # team Kanban: cross-project aggregation + ?project / ?assignee filters
│       │   ├── calendar/page.tsx    # team Calendar: all team tasks (incl. unassigned) + ?month
│       │   ├── analysis/page.tsx    # team Analysis: throughput / member load / health / zombie tasks (?range)
│       │   ├── settings/page.tsx    # team management (团队管理): team info/rename, invites, join-by-code and request approval, members, danger zone
│       │   └── projects/
│       │       ├── new/page.tsx      # create team project (edit/delete in project page header)
│       │       └── [projectSlug]/
│       │           ├── page.tsx      # team project page (list/kanban dual view)
│       │           └── tasks/[taskId]/ # team task detail
└── api/
    └── cron/
        └── due-scan/route.ts        # due-soon/overdue scan, secret-protected
```

- Both space types render the same domain pages; personal space has four modules (`dashboard` / `kanban` / `calendar` / `analysis`), team space has five (the same four plus `settings`, displayed as 团队管理). The pages share domain components, differentiated by `spaceType` / variant (see §5.2–§5.5).
- Personal settings are a **system-level page** at `/settings`, inside the `(dashboard)` group so it inherits AppShell and `requireUser()`: profile fields, change password, reminder toggles, language, project ordering. The former `/space/personal/settings` route was removed outright (404, no redirect).
- `personal` is a reserved spaceRef: team slug generation treats `personal` as taken (`RESERVED_SPACE_SLUGS` in `lib/slug.ts`); a team named "Personal" falls back to `personal-2`, leaving personal-space routing unaffected.
- Route parameters always use slugs (teams/projects); task details use opaque internal IDs.
- Personal and team tasks reuse the same task detail component; differences are handled via `spaceType` and the permission context.
- All `(dashboard)` routes perform login checks server-side (redirect to `/login`); insufficient permissions return a 403 page rather than merely hiding buttons.

### 5.1 Legacy URL redirects (`apps/web/next.config.ts`, all 307 temporary)

| Old path | New path | Notes |
|---|---|---|
| `/my` | `/space/personal/dashboard` | Former "my tasks" page |
| `/my/:path*` | `/space/personal/:path*` | Deep links to personal projects / task details |
| `/teams/:slug` | `/space/:slug/dashboard` | Former team overview page |
| `/teams/:slug/:path*` | `/space/:slug/:path*` | Deep links to team settings / project pages / task details |

- The team slug parameter uses the full-segment pattern `((?!(?:new|join)(?:/|$))[^/]+)` to exclude static pages: Next.js path-to-regexp does not accept `(?!new|join)` directly as a parameter pattern.
- `/teams/new`, `/teams/join`, and `/invites` are not space routes; they keep their own static pages and are not redirected.

### 5.2 Navigation (AppShell / SpaceNav)

- `AppShell` props: `{ nav, mobileNav, user, children }`.
- `SpaceNav`, `SpaceNavData` (`getSpaceNavData()` fetches everything in one pass), `SpaceNavMenu` (personal space: Dashboard / Kanban / Calendar / Analysis, no settings entry; team space: the same four plus Settings, labeled 团队管理 (team management), route unchanged; the item arrays are hardcoded per space type and shared by the desktop sidebar and the mobile drawer; a separate account group holds the pending-invites entry), and `MobileNav` (hamburger button below 861px, `aria-label="打开导航"` + Radix Sheet drawer).
- The desktop sidebar and the mobile Drawer share the same navigation tree; `(dashboard)/layout.tsx` imports are adjusted accordingly.

### 5.3 Space-level Kanban

One set of components for both spaces (`features/kanban/`; `SpaceKanban` distinguishes personal/team via `variant`):

| Route | Data scope |
|---|---|
| `/space/personal/kanban` | All of the user's personal tasks (incl. loose tasks), aggregated across projects |
| `/space/{teamSlug}/kanban` | Tasks of all the team's projects (incl. unassigned); non-members get 404 |

URL query contract (filter state lives in the URL; the RSC filters the three columns and done count server-side):

| Param | Space | Meaning |
|---|---|---|
| `project={projectSlug}` | Personal / team | Only that project; unknown or someone else's project slug is **silently ignored** (falls back to all, no 500) |
| `assignee=unassigned` | Team only | Only unassigned tasks; can combine with `project` |
| (none) | Both | All tasks |

- Columns are fixed: `todo / in_progress / done`; the done column converges by default to the last 7 days (`updatedAt >= today-6`), with an in-place "show N older completed" toggle that is reversible. The expanded state is **not in the URL** (ephemeral view state); any action that triggers `router.refresh()` (drag, mobile status button) resets the expanded view back to 7 days.
- Dragging only changes status, never project ownership; permissions follow `canEditTask` (a team member cannot drag others'/unassigned cards); below 861px dragging is disabled in favor of in-card status buttons.
- The expansion fetches via Server Action `getOlderDoneTasksAction` (`features/kanban/actions.ts`): the personal branch calls `requireUser()`, the team branch calls `getCurrentUser()` + membership check; filter params (`projectSlug` / `unassignedOnly`) are re-resolved to ids inside the action, invalid slugs ignored likewise.
- The team kanban header's "＋ New project" renders only for owner / admin, matching the gate on `/space/{teamSlug}/projects/new`.

### 5.4 Space-level Calendar

One set of components for both spaces (`features/calendar/`; `SpaceCalendar` distinguishes via `variant`):

| Route | Data scope |
|---|---|
| `/space/personal/calendar` | All of the user's personal tasks (incl. loose tasks), placed by due date |
| `/space/{teamSlug}/calendar` | Tasks of all the team's projects (incl. unassigned); non-members get 404 (does not leak team existence) |

URL query contract (month lives in the URL; the RSC fetches by query):

| Param | Meaning |
|---|---|
| `month={YYYY-MM}` | Month shown in the grid; month changes are written back by a client component via `router.push` |
| Missing / invalid / array params | **Silently fall back to the current month** (`todayInShanghai().slice(0, 7)`), no 500, no error |

- The month grid is fixed at 42 cells (6 weeks starting Monday, padded with adjacent-month dates), at most 3 chips per cell with "K more" overflow; done tasks are placed on their **original due date**, struck through and dimmed; tasks without `due_date` do not enter the grid; a "N tasks without due dates →" count entry (linking to Dashboard) exists **only on the personal page** — the team page header shows a hint line that unassigned tasks also appear by due date (no count entry).
- The sidebar has two blocks **anchored to "today", independent of the displayed month** (ruling: month paging only changes the grid): ① this week's tasks = the calendar week containing today `[getWeekStart(today), +6]`, grouped by day with today's group on top, **including done** (struck through in place); ② due this month = `(end of this week, end of today's month]`, **excluding done**, ascending by date, 5 by default + an in-place expand/collapse for the remaining K.
- Data is fetched in three independent windows: `getPersonalSpaceCalendar` / `getTeamSpaceCalendar` in `features/calendar/service.ts` query the month-grid window, this-week window, due-this-month window, and no-due-date count in parallel; sorting is uniformly `due_date asc, created_at desc`. Team rows `LEFT JOIN users` for the assignee (null when unassigned / member removed).
- Team chips are prefixed with the assignee avatar (initial + stable color from hashing `assigneeId`) or an "unassigned" outlined tag; personal chips carry no assignee.
- Read-only: chips / sidebar entries render as detail links via `taskHrefs` (built by the RSC); clicking empty cells does nothing; no drag-to-reschedule. On narrow screens (<861px) the sidebar stacks below the grid.
- Permissions: the team page verifies membership in the RSC before fetching, non-members get `notFound()`; the personal page's data scope is always the current user.

### 5.5 Space-level Analysis

One set of components for both spaces (`features/analysis/`; `SpaceAnalysis` distinguishes via `variant`), read-only self-drawn charts (no chart library):

| Route | Content |
|---|---|
| `/space/personal/analysis` | Stat cards (in progress / completed this month / currently overdue / on-time rate) + completion trend, created vs completed, upcoming due distribution, project comparison |
| `/space/{teamSlug}/analysis` | Stat cards + throughput, member load distribution, project health, zombie tasks (`in_progress` and untouched for 14 days, max 10), non-members 404 |

- `?range=7|30|90` determines the trend window; missing / invalid / array params **silently fall back to 30** (same lenient semantics as the calendar's `month`); 7/30 days bucket by day, 90 days by calendar week. Switching is written back to the URL by a client component and the RSC refetches; stat cards are a current snapshot and do not change with range.
- On-time rate uses a fixed 30-day window (decoupled from the header range); completion day = `updated_at`, creation day = `created_at` (no historical snapshot table — trends cannot be rebuilt after a task is deleted, a known boundary); member load is a current snapshot with no historical lookback.
- The personal scope predicate is always "tasks assigned to me" (personal tasks + team tasks assigned to me), consistent with the Dashboard; the team view reuses `getTeamOverview` for load and health.

## 6. Data Model

Core tables (fields summarized; the Drizzle schema and migrations are authoritative):

```
users
  id            internal primary key (not exposed)
  uid           external identifier, unique, doing_xxxx (used for invites)
  username      login name, unique
  nickname      display name (nullable; generated user_<5-hex> when left blank at registration)
  gender        male | female | secret (nullable)
  email         nullable, globally unique (stored lowercase)
  phone         nullable, globally unique
  due_soon_reminder_enabled / overdue_reminder_enabled
  language      zh | en
  password_hash
  created_at

teams
  id, name, slug (uniqueness strategy within team/global decided at implementation), owner_id -> users.id, created_at

team_memberships
  id, team_id -> teams.id, user_id -> users.id
  role          owner | admin | member
  joined_at
  UNIQUE(team_id, user_id)

team_invites
  id, team_id -> teams.id, invitee_id -> users.id, invited_by_id -> users.id
  status        pending | accepted | declined | rescinded
  created_at, responded_at
  UNIQUE(team_id, invitee_id) WHERE status = 'pending'   -- partial unique index

projects
  id, name, slug, description, created_at
  team_id -> teams.id (nullable: personal projects)
  owner_id -> users.id (owner of personal projects; null for team projects)
  CHECK((team_id IS NOT NULL) <> (owner_id IS NOT NULL))  -- exactly one
  -- slug uniqueness scope: team projects UNIQUE(team_id, slug); personal projects UNIQUE(owner_id, slug)

tasks
  id, project_id -> projects.id (nullable: personal tasks not in any project)
  space_type     personal | team
  title, description
  status         todo | in_progress | done
  assignee_id -> users.id (nullable: unassigned after member leaves/is removed)
  due_date       date (date only, Asia/Shanghai semantics)
  created_by_id -> users.id
  created_at, updated_at

subtasks
  id, task_id -> tasks.id (cascade delete), title, completed, created_at, completed_at

comments
  id, task_id -> tasks.id (cascade delete), author_id -> users.id, content, created_at

notifications
  id, user_id -> users.id, type, read
  team_id / project_id / task_id (used by type, nullable)
  actor_id -> users.id (null for system-generated notifications)
  created_at

sessions (not created: stateless jose signed cookie, see §3)
```

Key constraints and behavior:

- `users.uid` and `users.username` each get a unique index; UIDs are randomly generated and non-enumerable. `users.email` and `users.phone` are additionally globally unique and nullable: optional empty inputs are normalized to `NULL` (PostgreSQL unique indexes treat NULLs as distinct), and email is lowercased on write.
- **Display name**: `users.nickname` is the display name everywhere (assignee selectors, member lists, notification actor names, avatar initials); `username` remains the login identity. When the optional nickname is left blank at registration, the service stores a generated `user_<5-hex>` (first 5 lowercase hex chars of `sha256(uid)`) in `nickname`. Users can change it in `/settings` and it takes effect everywhere; `displayName(user)` in `@open-doing/types` resolves `nickname`, falling back to `username` for legacy rows. Avatar background color hashes the user id, not the name, so it stays stable across renames.
- Personal-space data: tasks with `space_type = 'personal'` (`project_id` may point to the owner's personal project or be null) and personal projects with `owner_id = self` are accessible only by the owner (see §7); personal-project tasks always have `assignee_id` = the owner.
- **Cascade deletes**: deleting a project (team or personal) → its tasks/subtasks/comments and related notifications; dissolving a team → its projects, memberships, invites, notifications. Backed by database foreign keys `ON DELETE CASCADE`, with a second confirmation in the app layer.
- Removing a member / leaving: only deletes `team_memberships`, **not tasks**; their `assignee_id` is nulled.
- The partial unique index `WHERE status = 'pending'` prevents multiple pending invites for the same person (same pattern on `team_join_requests`); identifier columns (username, uid, slug, join_code, status, …) use PostgreSQL `text`, whose equality/uniqueness comparison is case-sensitive by default. `email` is case-insensitive in practice because the service lowercases it on write; `phone` is digits-only (enforced by `PHONE_PATTERN`), so case does not apply to it. This choice is documented in the comment on the `email` column in `schema.ts`.

## 7. Permission Model (enforcement points)

The role matrix is in the design document (§5). Architectural enforcement principles:

1. **Every Server Action performs its own authorization** and never trusts that a page merely hides the entry point. Centralized in `features/teams`:
   - `getMembership(teamId, userId)` → role or null;
   - `can(action, actor, resource)`-style decisions (e.g. `canEditTask`: the assignee themselves or team owner/admin).
2. Data queries carry **visibility filters**: team tasks are visible only when "I am a member of that team"; personal-space data (personal tasks, personal projects) is visible only to the owner.
3. Comment permission and task-content edit permission are separate: members may comment but cannot edit others' task content.
4. Team management actions (create project, invite, remove member, delete project, dissolve, transfer) are re-validated for owner/admin in the service layer; personal-project create/edit/delete only checks `owner_id = current user`, fully independent of the team role system.

## 8. Progress Aggregation and Due Dates

Pure computation lives in `@open-doing/types`; the server only fetches data:

- Task progress: with subtasks → completed subtasks / total subtasks; without → status mapping 0 / 0.5 / 1.
- Project progress: equal-weight average of all the project's tasks, empty project 0 (same for team and personal projects); team progress: equal-weight average across the team's projects, 0 when there are none; personal projects do not participate.
- Dashboard aggregations are computed in the database (SQL aggregation of task/subtask counts); the app layer applies the same semantics rather than pulling whole tables into memory.
- `due_date` uses the PostgreSQL `date` type. Overdue: `current date (Asia/Shanghai) > due_date and status != done`; due soon: `due_date IN (today, tomorrow) and not completed`. Timestamps are stored as `timestamptz` (absolute instants), so reads are independent of the database session timezone; calendar-day math is done explicitly in Asia/Shanghai.

## 9. Notifications

- Notifications are produced **synchronously by domain actions** (invite, assign, comment, admin changes), written in the same transaction as the business change to avoid loss.
- Due-soon/overdue notifications come from `POST /api/cron/due-scan` (the scan includes personal-space tasks — self reminders; personal projects do not produce assign/comment/change notifications):
  - Authenticated via a cron secret from env (e.g. `Authorization: Bearer` or a custom header);
  - Idempotent: one notification per task per type per due window (dedupe constraint on `(user_id, task_id, type)` or a pre-write check);
  - Tasks completed after the scan produce no new notifications (historical ones are kept).
- The frontend polls the unread count in the `(dashboard)` layout for the badge; the notification center supports the list and marking as read.

## 10. Server Rendering and Data Fetching Conventions

- Pages are RSC by default: fetch data on the server per session user, no public API.
- Mutations go through Server Actions; Route Handlers are used only for cron (no public REST API).
- Client components are limited to: kanban drag-and-drop, form interactions, notification polling, view switching.
- The database connection lives in `server/db.ts` as a singleton to avoid multiple connections from dev hot reload.

### 10.1 Request-level locale resolution (i18n)

Per-request UI language resolves by the following priority (`getRequestLocale` in `src/i18n/server.ts`, deduped per request via React `cache`):

1. **Logged in: `users.language` is the single authority** — taken from the session user; a language switch takes effect on the next request across devices;
2. **Anonymous: cookie `od_locale`** (validated by `normalizeLocale`, invalid values fall back to zh);
3. **Neither: fall back to `zh`**.

The resolution drives three switches in sync: next-intl message catalog (`getRequestConfig` dynamically imports by locale), the dayjs global locale (root Providers), and `<html lang>` (root layout, `LOCALE_HTML_LANG` maps zh→`zh-CN`, en→`en-US`). Missing any one of the three surfaces as a hydration error or mixed-language date components.

Error translation inside Server Actions goes through `standardFailuresForRequest()` (which picks a translator by request locale), using `failures.custom("<domain ns>.<key>", params)` to translate domain errors onto `field ?? "form"`; `lib/domain-failure.ts` provides the pure-function variant `domainFailureWith` with an injectable translator for unit testing. Convention details (the cjk-guard / messages-parity enforcement tests, notification `<b>` template parsing) are in the "Internationalization" section of the repo-root `AGENTS.md`.

## 11. Configuration and Environment

Environment variables required by `apps/web` (`.env.local`, not committed):

```
DATABASE_URL=postgres://open-doing:open-doing@localhost:5433/open_doing
SESSION_SECRET=...
CRON_SECRET=...
```

- `docker-compose.yml` at the repo root starts the local PostgreSQL 16 (host port 5433, overridable via `PG_PORT`).
- Drizzle config and migration files live in the web package (`src/server/db/` + `drizzle/`), run via `pnpm --filter @open-doing/web db:generate / db:migrate`.
