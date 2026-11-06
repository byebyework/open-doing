# UX Refinements Implementation Plan (registration profile / settings restructure / hint badges)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the three UX refinements from the spec: optional profile fields (nickname/gender/email/phone) with generated default nickname, settings restructure (`/settings` + 团队管理), and hint-badge conversion plus P1-P5 walkthrough fixes.

**Architecture:** Add 4 nullable columns to `users`; extend registration (service + form) with normalization, uniqueness dispatch, and `user_xxxxx` generated nickname; make `nickname` the display name across read models and UI; move personal settings out of the space nav into a top-level `(dashboard)/settings` route + user-menu entry; rename the team nav item; add a reusable `HintBadge` (Popover) client component and convert secondary explanations on listed pages.

**Tech Stack:** Next.js App Router (RSC + Server Actions), Drizzle ORM + MySQL 8.0, vendored shadcn/ui (Radix), next-intl, Vitest + Playwright.

**Spec:** `docs/superpowers/specs/2026-11-06-ux-refinements-design.md` — the binding authority; this plan argues from it.

## Global Constraints

- All user-visible copy in `apps/web/src/i18n/messages/{zh,en}.json` with identical key structure (messages-parity test); no hardcoded CJK (cjk-guard test; add whitelist entries inside the test with justification when non-copy Chinese is unavoidable, e.g. service zh fallbacks in `features/users/service.ts`).
- Do NOT replace the custom `tzTimestamp` type in `schema.ts`; do NOT modify frozen contracts (AppShell props shape, `(dashboard)/layout.tsx` import relationships); `docs/prototypes/` stays frozen.
- Enum/identifier columns use the existing `identifierVarchar` helper; `email` uses default collation (deliberate — case-insensitive) and is lowercased on write; empty-string optional inputs are normalized to `NULL`.
- MySQL 8.0 via Drizzle; migration must replay on an empty database (`server/db/testing.ts` replays it on every vitest run — any schema/test run exercises this).
- Cross-boundary data is serializable (Drizzle rows mapped in the features layer); Radix primitives only inside `"use client"` components; every Server Action authorizes itself (profile actions are self-only via `getCurrentUser()`).
- Avatar colors hash by user id, not by name (nickname edits must not change colors).
- The analysis "未指派" callout is NOT badge-converted (stakeholder decision — it holds the only link to the unassigned kanban view). No redirect for the old personal-settings route: `/space/personal/settings` is removed (404).
- Test env: vitest/drizzle-kit do NOT read `.env.local` — export vars first (`set -a; source apps/web/.env.local; set +a`). Test files run serially; `TEST_DATABASE_URL` must stay the test db.
- Commits: Conventional Commits, English subject, end with `Co-Authored-By: Claude Code <noreply@anthropic.com>`.
- Task 13 runs the full gate: `pnpm lint`, `pnpm test`, `pnpm --filter @open-doing/web exec next typegen` then `pnpm typecheck`, affected e2e flows.

## Review Focus

- Empty-string optional input ("") must become `NULL`, never stored — a second empty email would collide on the unique index. Test in Task 4 (`registerUser` with `email: ""` stores null).
- A duplicate email at registration must surface as an email field error, never as `UID_GENERATION_FAILED`. Test in Task 4.
- Nickname edit must not change avatar color. Test in Task 6 (`UserAvatar` keyed by id/uid).
- Badge popover content is unrendered until clicked — page tests/e2e must assert the trigger summary, or click first. Tests in Tasks 10-11.
- The old personal-settings route must 404 (no redirect) and `/settings` must work. Test in Task 7 (e2e flow 09).
- An invalid `gender` value reaching the service must be rejected, not stored. Test in Task 8.

---

### Task 1: users table — 4 new columns, migration, seed nicknames

**Files:**
- Modify: `apps/web/src/server/db/schema.ts` (users table, lines 101-113)
- Modify: `apps/web/drizzle/` (new generated migration)
- Modify: `apps/web/src/server/db/seed.ts` (SEED_USERS + insert, ~lines 50-75)
- Test: `apps/web/src/server/db/schema.test.ts` (extend)

**Interfaces:**
- Produces: columns `nickname varchar(50)` (nullable), `gender` = `identifierVarchar("gender").$type<Gender>()` (nullable), `email varchar(255)` nullable `.unique()`, `phone varchar(20)` nullable `.unique()`; `Gender` imported from `@open-doing/types` (Task 2 adds it — define `export type Gender = "male" | "female" | "secret"` in `packages/types/src/index.ts` in this task so schema compiles).
- Schema header comment on the email line: default collation is deliberate (case-insensitive uniqueness), values lowercased on write.

- [ ] **Step 1: Add failing schema test** in `schema.test.ts`: assert the users table columns include nullable `nickname`/`gender`/`email`/`phone` and that `email`/`phone` carry unique indexes named `users_email_unique` / `users_phone_unique` (match however existing unique-index assertions are written in this file).
- [ ] **Step 2: Run** `pnpm vitest run apps/web/src/server/db/schema.test.ts` (with env exported). Expected: FAIL (columns missing).
- [ ] **Step 3: Implement**: add `Gender` to `packages/types/src/index.ts`; add the four columns to `users` in `schema.ts` with the comment from Interfaces. Run `pnpm --filter @open-doing/web db:generate` (review the generated SQL: `nickname`/`gender`/`email`/`phone` ADD COLUMN, two unique indexes) then `pnpm --filter @open-doing/web db:migrate` against dev db.
- [ ] **Step 4: Update seed** so each `SEED_USERS` entry also gets `nickname: username` (e.g. 林夏 → nickname 林夏); seed inserts stay idempotent. Re-run `pnpm db:seed` to confirm idempotence.
- [ ] **Step 5: Run** full `pnpm test` (replays migration on the test db). Expected: PASS (no regression).
- [ ] **Step 6: Commit** `feat(db): add nickname gender email phone columns to users`

### Task 2: User domain model — nickname/profile fields + displayName helper

**Files:**
- Modify: `packages/types/src/index.ts` (User interface, lines 29-37)
- Modify: `apps/web/src/features/users/service.ts` (UserRow + toUser, lines 9-25)
- Modify: `apps/web/src/features/auth/service.ts` (register/login select + toUser call, lines 174-185)
- Test: `packages/types/src/index.test.ts`

**Interfaces:**
- Produces: `User` gains `nickname: string | null`, `gender: Gender | null`, `email: string | null`, `phone: string | null` (doc comment: nickname is the display name; username is login-only). New pure helper in `packages/types`:
  ```ts
  export function displayName(user: { nickname: string | null; username: string }): string
  ```
  returns `user.nickname ?? user.username`.
- `toUser` row type gains the same four columns; callers that select partial rows keep compiling because `toUser` requires them — update both call sites in `auth/service.ts` and any other `toUser` caller to select the four columns too.

- [ ] **Step 1: Failing test** in `packages/types/src/index.test.ts`: `displayName({ nickname: "阿岚", username: "u1" }) === "阿岚"`; `displayName({ nickname: null, username: "u1" }) === "u1"`.
- [ ] **Step 2: Run** `pnpm vitest run packages/types/src/index.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** helper + extend `User`; fix `toUser` and its call sites (select the four new columns; map to ISO/typed values — all serializable).
- [ ] **Step 4: Run** `pnpm test` — all feature-service tests that construct fake `User` objects may fail; fix their fixtures by adding the new nullable fields.
- [ ] **Step 5: Commit** `feat(types): extend user model with profile fields and displayName`

### Task 3: unique-violation key extraction in db errors

**Files:**
- Modify: `apps/web/src/server/db/errors.ts` (next to `isUniqueViolation`, lines 22-31)
- Test: `apps/web/src/server/db/errors.test.ts` (create if absent; otherwise extend)

**Interfaces:**
- Produces:
  ```ts
  export type UniqueKey = "users_username_unique" | "users_email_unique" | "users_phone_unique";
  export function uniqueViolationKey(error: unknown): UniqueKey | null;
  ```
  Detection mirrors `isUsernameConflict` (auth/service.ts:133-143): check `errorChain(error)` items' `constraint_name` or `message` for the exact index name.

- [ ] **Step 1: Failing tests**: message containing `users_email_unique` → `"users_email_unique"`; constraint_name path for each of the three keys; non-unique error → `null`; error without those names but still 1062 (e.g. `users_uid_unique`) → `null`.
- [ ] **Step 2: Run** `pnpm vitest run apps/web/src/server/db/errors.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** `uniqueViolationKey`; refactor `isUsernameConflict` in `auth/service.ts` to delegate to it (`uniqueViolationKey(error) === "users_username_unique"`) — behavior unchanged.
- [ ] **Step 4: Run** `pnpm vitest run apps/web/src/features/auth/service.test.ts` + errors test. Expected: PASS.
- [ ] **Step 5: Commit** `feat(db): extract violated unique index name from mysql errors`

### Task 4: registration backend — profile fields, normalization, generated nickname, uniqueness dispatch

**Files:**
- Modify: `apps/web/src/features/auth/service.ts` (AuthInput :75, validateRegistration :95, isUsernameConflict :133, registerUser :152, login :212 unchanged)
- Test: `apps/web/src/features/auth/service.test.ts` (extend)

**Interfaces:**
- Produces:
  ```ts
  export interface AuthInput {
    username: string;
    password: string;
    nickname?: string;            // trim; ≤50 chars; empty/absent → generated
    gender?: string;              // must be "male" | "female" | "secret" or absent
    email?: string;               // trim; empty → null; lowercased; /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    phone?: string;               // trim; empty → null; /^[+\-0-9]{7,20}$/
  }
  export function generateNickname(uid: string): string; // "user_" + first 5 lowercase hex chars of sha256(uid)
  ```
- Validation errors: `AuthError("VALIDATION", zh fallback, field, { key, params })` with fields `nickname` / `gender` / `email` / `phone` and keys `nicknameMaxLength`, `genderInvalid`, `emailInvalid`, `phoneInvalid`.
- Uniqueness: after `isUniqueViolation`, branch on `uniqueViolationKey` (Task 3) — `users_email_unique` → `AuthError("EMAIL_TAKEN", ..., "email", { key: "emailTaken" })`; `users_phone_unique` → `("PHONE_TAKEN", ..., "phone", { key: "phoneTaken" })`; username branch unchanged; only remaining 1062 errors continue the UID retry loop.

- [ ] **Step 1: Failing tests** in `service.test.ts`:
  - `registerUser` with `email: ""` → stored `email` is `null` (assert via returned User); same for `phone: ""`.
  - `email: "A@B.COM "` → stored lowercase trimmed `"a@b.com"`.
  - `registerUser` with `gender: "other"` → throws with `field: "gender"`, `key: "genderInvalid"`.
  - `phone: "123"` → throws `key: "phoneInvalid"`.
  - `nickname` longer than 50 chars → throws `key: "nicknameMaxLength"`.
  - `generateNickname("doing_x7k2m9")` is `"user_"` + 5 hex chars, deterministic (call twice, equal).
  - **Unique dispatch (DB test)**: insert a user with `email: "taken@test.com"` first; `registerUser` with same email → throws with `field: "email"`, `key: "emailTaken"` (assert it is NOT `UID_GENERATION_FAILED`); same for phone.
  - Absent nickname → returned `User.nickname` matches `generateNickname(uid)`.
- [ ] **Step 2: Run** `pnpm vitest run apps/web/src/features/auth/service.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** per Interfaces. `generateNickname` uses node `crypto.createHash("sha256")`. The register insert gains `nickname`/`gender`/`email`/`phone`; nickname generated after uid. Uniqueness branches run BEFORE the UID retry interpretation.
- [ ] **Step 4: Run** `pnpm vitest run apps/web/src/features/auth/service.test.ts`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(auth): accept profile fields at registration with uniqueness dispatch`

### Task 5: registration form — optional fields + P1 copy fixes

**Files:**
- Modify: `apps/web/src/features/auth/components/RegisterForm.tsx`
- Modify: `apps/web/src/features/auth/actions.ts` (register action passes new optional fields through)
- Modify: `apps/web/src/i18n/messages/zh.json` + `en.json` (auth namespace)
- Test: extend existing RegisterForm test if one exists (search `RegisterForm.test`), else verify via e2e in Task 13.

**Interfaces:**
- Consumes: `registerAction` must accept and forward the new optional fields (action input type mirrors Task 4 `AuthInput`).
- Copy (spec §1, fixes P1): subtitle "只需用户名和密码,无需邮箱" → new subtitle naming all fields as optional; helper under username → "仅用于登录"; UID info block stays (badge conversion is Task 11).
- New i18n keys (zh + en, auth ns): `nicknameLabel`, `nicknamePlaceholder`, `nicknameMaxLength`, `genderLabel`, `genderMale`/`genderFemale`/`genderSecret`, `genderInvalid`, `emailLabel`, `emailPlaceholder`, `emailInvalid`, `emailTaken`, `phoneLabel`, `phonePlaceholder`, `phoneInvalid`, `phoneTaken`, plus updated `subtitle`/`usernameExtra`.
- Gender control: three-option radio group (label + two radios per row if needed); use the vendored `radio-group` if present in `components/ui/shadcn/`, else vendor it in following the set's conventions (Radix primitive + cva + header comment documenting adaptations) — do not hand-roll.

- [ ] **Step 1: Add zod schema fields** (all optional; reuse the exact messages from Task 4 keys via `t(...)`): nickname max 50, email `/^[^\s@]+@[^\s@]+\.[^\s@]+$/`, phone `/^[+\-0-9]{7,20}$/`; gender enum. Map action field errors (`nickname`/`gender`/`email`/`phone`) onto the matching inputs (follow the existing username/password error-mapping pattern).
- [ ] **Step 2: Implement** the four optional inputs after the password rows, visual order: 昵称 / 性别 / 邮箱 / 电话; `data-testid`: `auth-nickname-input`, `auth-gender-male|female|secret`, `auth-email-input`, `auth-phone-input`. Update subtitle/usernameExtra copy keys.
- [ ] **Step 3: Add i18n entries** zh + en (messages-parity will fail otherwise).
- [ ] **Step 4: Run** `pnpm vitest run src/i18n` (parity + cjk-guard). Expected: PASS.
- [ ] **Step 5: Commit** `feat(auth): optional profile fields on register form and p1 copy fixes`

### Task 6: display-name sweep + avatar color keyed by id

**Files:**
- Modify: `apps/web/src/components/ui/UserAvatar.tsx` (hashUsername, lines ~20-45)
- Modify: `apps/web/src/components/layout/Topbar.tsx` (lines ~103-107)
- Modify: display-name call sites listed below (features + components)
- Test: `apps/web/src/components/ui/UserAvatar.test.tsx` (create)

**Interfaces:**
- Consumes: `displayName` from `@open-doing/types` (Task 2).
- Produces: `UserAvatar` props become `{ userId: string; name: string; size?: number }` — background color hashes `userId` (rename `hashUsername` → `hashSeed`, same FNV-1a), initial char comes from `name` (which callers pass as `displayName(user)`). Every existing call site updates: pass the user's id for color and the display name for the initial.
- Display-name sweep (spec §1): every UI point that renders `user.username` as a name switches to `displayName(user)` — Topbar avatar+aria; `features/teams/components/MemberList.tsx`, `JoinRequestList.tsx`, `TransferTeamButton.tsx`, `MemberLoadList.tsx` (~lines 68-164); `features/kanban/components/SpaceKanban.tsx:393`, `TeamKanban.tsx:194`, `TeamProjectTaskTable.tsx:351`; `components/ui/task-detail/TaskDetailView.tsx:439,600-653`; `CommentBox.tsx:111-116`; `MilestoneList.tsx:119`; `SpaceAnalysis.tsx:383-385,605`; pending-invites and `/invites` pages; notification body `actorName` mapping (`features/notifications/components/notification-format.ts:44-51` + `features/notifications/queries.ts:128,178` — server read models select nickname too). Grep `user.username` / `.username` used in display contexts to catch stragglers; login/session logic keeps username.
- Server read models that carry a display name (teams/kanban/calendar/dashboard/analysis/notification queries) must select `users.nickname` alongside `username` and emit both (or a resolved name) — keep serializable; when only one name string is emitted, emit `nickname ?? username` resolved in the features layer.

- [ ] **Step 1: Failing test** `UserAvatar.test.tsx`: two users with the same `name` but different `userId` get different background colors (deterministically assert via the exported color list / class, matching how ACCENT_COLORS is exposed); same `userId` different `name` → same color.
- [ ] **Step 2: Run** `pnpm vitest run apps/web/src/components/ui/UserAvatar.test.tsx`. Expected: FAIL.
- [ ] **Step 3: Implement** avatar change + the sweep above, one feature folder at a time; components stay serializable (pass `displayName`-resolved strings or raw nickname+username pairs from RSCs).
- [ ] **Step 4: Run** `pnpm test` full suite. Expected: PASS (update any test fixtures asserting username-as-display-name).
- [ ] **Step 5: Commit** `feat(ui): switch display name to nickname and key avatar color by user id`

### Task 7: settings restructure — `/settings` route, nav, user menu

**Files:**
- Create: `apps/web/src/app/(dashboard)/settings/page.tsx` (move content of the file below)
- Delete: `apps/web/src/app/(dashboard)/space/personal/settings/page.tsx` (and its directory; NO redirect)
- Modify: `apps/web/src/lib/routes.ts` (add `personalSettingsHref`)
- Modify: `apps/web/src/components/layout/SpaceNavMenu.tsx` (MODULES :148-158)
- Modify: `apps/web/src/components/layout/Topbar.tsx` (user menu)
- Modify: `apps/web/src/i18n/messages/zh.json` + `en.json` (`nav.teamManagement`, `nav.personalSettings`, `meta.personalSettingsTitle`; remove `nav.settingsLabel` if now unused)
- Modify: e2e `flows/09-personal-settings.spec.ts`, `flows/11-*` (drawer item), `flows/12-*` (hardcoded route), `responsive.spec.ts` (团队设置 heading)

**Interfaces:**
- Consumes: `moduleHref`, `SpaceModule` from `routes.ts`; `resolveSpaceLocation` from `SpaceNavMenu`.
- Produces: `export function personalSettingsHref(): string { return "/settings"; }` in `routes.ts`.
- Nav: personal space renders 4 items (dashboard/kanban/calendar/analysis — no settings); team space renders 5 with the last labeled `nav.teamManagement` (zh 团队管理) pointing at `moduleHref(slug, "settings")` (route unchanged). Use `resolveSpaceLocation(pathname).spaceRef !== "personal"` to pick the variant; mobile drawer shares the component automatically.
- Topbar user menu: new entry above 退出登录 — link to `personalSettingsHref()`, gear icon, label `nav.personalSettings`, `data-testid="user-menu-settings"`.
- `/settings` page: same content as the moved file; `generateMetadata` uses `meta.personalSettingsTitle`; keeps `requireUser()`.

- [ ] **Step 1: Move the page** (git mv the file to the new path, adjust metadata key), add `personalSettingsHref`, delete the old directory. Verify `pnpm --filter @open-doing/web exec next typegen` picks up the new route.
- [ ] **Step 2: Update SpaceNavMenu** per Interfaces; update Topbar user menu.
- [ ] **Step 3: i18n** keys zh + en.
- [ ] **Step 4: Update the four e2e files** per Files (flow 09: navigate via user menu click, assert URL `/settings`, and assert `/space/personal/settings` returns 404; flow 12: use `/settings`; responsive: expect 团队管理).
- [ ] **Step 5: Run** `pnpm vitest run src/i18n` + `pnpm --filter @open-doing/web exec next typegen` + `pnpm typecheck`. Expected: PASS.
- [ ] **Step 6: Commit** `feat(nav): move personal settings to /settings and rename team settings nav`

### Task 8: profile editing — service + action + form on `/settings`

**Files:**
- Modify: `apps/web/src/features/users/service.ts` (add profile read/update)
- Modify: `apps/web/src/features/users/actions.ts` (add `updateProfileAction`)
- Create: `apps/web/src/features/users/components/ProfileForm.tsx` (`"use client"`)
- Modify: `apps/web/src/app/(dashboard)/settings/page.tsx` (new 个人资料 card)
- Modify: `apps/web/src/i18n/messages/zh.json` + `en.json` (`users.profile.*` namespace)
- Modify: `apps/web/src/i18n/cjk-guard.test.ts` (whitelist entry for `features/users/service.ts` zh fallbacks)
- Test: `apps/web/src/features/users/service.test.ts` + `actions.test.ts` (extend)

**Interfaces:**
- Produces:
  ```ts
  export interface UserProfile { nickname: string | null; gender: Gender | null; email: string | null; phone: string | null }
  export async function getProfile(userId: string, client?: DbClient): Promise<UserProfile>
  export async function updateProfile(input: { userId: string } & Partial<Omit<UserProfile, never>>, client?: DbClient): Promise<UserProfile>
  export async function updateProfileAction(input: { nickname?: string; gender?: string; email?: string; phone?: string }): Promise<ActionResult<UserProfile>>
  ```
- Validation mirrors Task 4 exactly (trim → empty=null, lowercase email, phone regex, gender enum, nickname ≤50) — implement once in `users/service.ts`; Task 4's auth validation stays as-is (registration-specific errors), acceptable duplication noted in the spec.
- Errors: service throws a `UserError` (follow the `AuthError` shape: zh fallback, field, `{ key, params }`) with keys `users.profile.nicknameMaxLength`, `genderInvalid`, `emailInvalid`, `phoneInvalid`, `emailTaken`, `phoneTaken`; the action maps via `standardFailuresForRequest().custom("users.profile.<key>")` onto `field ?? "form"` (mirror `features/auth/actions.ts` `toFailure`). Uniqueness mapping uses `uniqueViolationKey` (Task 3) inside `updateProfile`'s catch.
- Action authorization: `getCurrentUser()`; unauthenticated → `notLoggedIn()`; `userId` always from session (self-only).
- ProfileForm: react-hook-form + zod, same field order/testids as Task 5 (`profile-*` prefixed), success → `router.refresh()` + sonner toast `users.profile.saved`.

- [ ] **Step 1: Failing tests** in `users/service.test.ts`: update normalization (empty→null, lowercase email, invalid gender/phone/length throws with field+key); duplicate email via pre-inserted row throws `emailTaken`; `updateProfile` with no keys returns current values. Action test: unauthenticated → notLoggedIn failure; happy path returns profile.
- [ ] **Step 2: Run** `pnpm vitest run apps/web/src/features/users/`. Expected: FAIL.
- [ ] **Step 3: Implement** service + action; add cjk-guard whitelist entry for `features/users/service.ts` (zh fallback strings, justified); build ProfileForm; add the card to `/settings` using the existing `SettingsCardHeader` pattern from the moved page.
- [ ] **Step 4: i18n** `users.profile.*` zh + en.
- [ ] **Step 5: Run** `pnpm vitest run apps/web/src/features/users/ src/i18n`. Expected: PASS.
- [ ] **Step 6: Commit** `feat(users): profile editing on /settings with self-only authorization`

### Task 9: teammate visibility — member list profile columns

**Files:**
- Modify: `apps/web/src/features/teams/service.ts` (member row select + mapping, ~lines 225-239)
- Modify: `apps/web/src/features/teams/components/MemberList.tsx` (~lines 68-104)
- Modify: `apps/web/src/i18n/messages/zh.json` + `en.json` (teams ns: `memberGender`, `memberEmail`, `memberPhone`, gender value labels reuse Task 5 keys or add under teams)
- Test: extend the teams service test file if present (search `features/teams/*.test.ts`)

**Interfaces:**
- Consumes: `displayName` (Task 2), gender values from Task 1 columns.
- Produces: member list model rows carry `nickname`, `gender`, `email`, `phone` (serializable); the member table gains 性别 / 邮箱 / 电话 columns — gender rendered via i18n labels, `null` renders "—". Existing visibility gating around `listMembers` stays (page-level, already member-only).

- [ ] **Step 1: Extend** the teams service member query to select the four columns and map them through.
- [ ] **Step 2: Update MemberList** table header + row cells (use `displayName` for the name cell; add the three columns).
- [ ] **Step 3: i18n** zh + en; run `pnpm vitest run src/i18n` + teams tests. Expected: PASS.
- [ ] **Step 4: Commit** `feat(teams): show gender email phone in member management table`

### Task 10: HintBadge component

**Files:**
- Create: `apps/web/src/components/ui/HintBadge.tsx` (`"use client"`)
- Test: `apps/web/src/components/ui/HintBadge.test.tsx`

**Interfaces:**
- Consumes: vendored `components/ui/shadcn/popover.tsx` (Radix Popover Root/Trigger/Content).
- Produces:
  ```tsx
  export interface HintBadgeProps {
    summary?: string;      // live at-a-glance text on the trigger (e.g. "13 个未完成"); optional
    title?: string;        // popover heading
    items?: string[];      // popover bullet list (or children for rich content)
    ariaLabel: string;     // translated by the caller
    children?: ReactNode;  // rich popover content alternative to items
    className?: string;
  }
  export function HintBadge(props: HintBadgeProps): JSX.Element;
  ```
  Trigger: inline-flex ⓘ icon (lucide `Info`, same size as existing small icons) + optional summary; token variables only (`var(--ink-*)`, `var(--border-default)`), no literal hex. Content: max-w ~320px, `title` + items/children. Callers invoke ui-ux-pro-max / frontend-design skills for the visual pass before polishing (spec §3).

- [ ] **Step 1: Failing test**: SSR render (no interaction) shows `summary` text and the trigger (accessible name = `ariaLabel`); popover content is NOT in the document until `userEvent.click` on the trigger; after click, `title` and first item are visible.
- [ ] **Step 2: Run** `pnpm vitest run apps/web/src/components/ui/HintBadge.test.tsx`. Expected: FAIL.
- [ ] **Step 3: Implement** with the vendored Popover.
- [ ] **Step 4: Run** again. Expected: PASS.
- [ ] **Step 5: Commit** `feat(ui): add HintBadge popover component for secondary hints`

### Task 11: badge conversions across pages

**Files (conversion points from spec §3):**
- Modify: kanban filter bar / stat strip (`features/kanban/components/SpaceKanbanFilterBar.tsx:37-39,141-143`, `KanbanStatStrip*`) — 口径 line, live filter-status line (summary on trigger + detail in popover), 基准日期 corner
- Modify: dashboard ℹ info block (personal + team overview components)
- Modify: calendar 未指派 note + 基准日期 (`features/calendar/components/SpaceCalendar.tsx` etc.; personal + team)
- Modify: analysis 口径 corner lines (`SpaceAnalysis.tsx`) — **NOT** the 未指派 callout (Global Constraints)
- Modify: login page "v1 暂不支持找回密码" note (`(auth)/login`)
- Modify: register page UID info block (`RegisterForm.tsx` block)
- Modify: team management page section paragraphs (invite / join-by-code / danger zone)
- Modify: personal settings page note blocks (reminder / sorting explanations)
- Modify: `apps/web/src/i18n/messages/zh.json` + `en.json` (new keys per page ns)
- Test: update `features/kanban/components/KanbanStatStrip.test.tsx` (assert trigger summary, click for detail) and any page tests asserting removed visible text.

**Interfaces:**
- Consumes: `HintBadge` (Task 10). RSCs pass translated strings + live values as props (client wrappers receive serializable data only).
- Rule: page subtitle stays visible; only the listed secondary lines convert; warning/action-required content (`remindersDisabledAlert`, danger-zone confirm explanations) stays visible — badge-ify only informational explanation blocks.

- [ ] **Step 1: Convert auth pages + team management + personal settings** blocks (static content) — replace the explanation elements with `HintBadge` carrying the existing copy (move copy keys under hint-specific keys or reuse existing).
- [ ] **Step 2: Convert space pages** (kanban / dashboard / calendar / analysis) — for live values (filter counts, 基准日期, 共完成 N), render the live value as `summary` from RSC props and the explanation as popover items.
- [ ] **Step 3: Update tests** that asserted the now-hidden text: assert the trigger summary instead, or click then assert (KanbanStatStrip.test.tsx:60-61 and e2e flows 06/07 visible-text assertions — list them via grep before changing).
- [ ] **Step 4: Run** `pnpm test` + `pnpm vitest run src/i18n`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(ui): convert secondary explanations to hint badges across pages`

### Task 12: walkthrough fixes P3 / P4 / P5

**Files:**
- P3 Modify: `features/analysis/components/SpaceAnalysis.tsx` (在册项目 card subtitle, ~lines 469-478) — subtitle becomes a short count-only line (new key `analysis.enrolledSummary` with `{count}`; no project-name list, no overflow).
- P4 Modify: team calendar grid container (`features/calendar/components/TeamCalendar.tsx` or equivalent) — wrap the 42-cell grid in `overflow-x-auto` with a right scroll shadow (gradient via `var(--ink-*)`/alpha token) visible when scrollable; verify at 375px viewport width.
- P5 Modify: kanban stat strip wording — confirm the 已完成 stat subtitle reads "近 7 天完成 N" and matches the 口径 badge text from Task 11 (zh + en); unify any stray wording.

- [ ] **Step 1: P3** implement + i18n keys; assert no long list rendering in the card subtitle.
- [ ] **Step 2: P4** implement scroll affordance; check with Playwright at 375px width manually (dev server) that the last column is reachable.
- [ ] **Step 3: P5** unify wording keys.
- [ ] **Step 4: Run** `pnpm vitest run src/i18n` + analysis/calendar/kanban tests. Expected: PASS.
- [ ] **Step 5: Commit** `fix(ui): analysis subtitle overflow, calendar scroll affordance, kanban stat wording`

### Task 13: docs sync + full gate + affected e2e

**Files:**
- Modify: `docs/ARCHITECTURE.md` — module navigation description (personal 4 modules + top-level `/settings`, team 5 modules with 团队管理), display-name rule (nickname is the display name; generated `user_xxxxx` at registration), `/space/personal/settings` removal.
- Modify: `docs/2026-10-21-open-doing-v1-design.md` — the corresponding display-name / settings-structure paragraphs (~line 59 area).
- Verify: `apps/web/src/server/db/schema.ts` header comment (Task 1) present.

- [ ] **Step 1: Update the two docs** (spec's 文档同步义务 section is the checklist).
- [ ] **Step 2: Run the full gate** with env exported: `pnpm lint` → `pnpm test` → `pnpm --filter @open-doing/web exec next typegen` → `pnpm typecheck`. All must pass.
- [ ] **Step 3: e2e** — stop the dev server first (Next 16 same-dir lock), start MySQL, then run `pnpm --filter @open-doing/web test:e2e -- flows/01-auth.spec.ts flows/02-team-invite.spec.ts flows/06-space-kanban.spec.ts flows/07-space-calendar.spec.ts flows/09-personal-settings.spec.ts flows/11-*.spec.ts flows/12-*.spec.ts responsive.spec.ts` (plus any flow Task 11 flagged). Fix breakages in this task.
- [ ] **Step 4: Restart the dev server** afterwards.
- [ ] **Step 5: Commit** `docs: sync architecture and v1 design with profile fields and settings restructure`
