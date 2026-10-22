# M0 基座实施计划（F-1 ~ F-6）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 完成 v1 任务板 M0 基座：共享类型与纯函数、测试设施、全量 DB schema、antd 主题、应用外壳与导航桩、认证会话——达到 `pnpm dev` 可注册登录看到真实主题的空外壳，共享契约冻结。

**Architecture:** pnpm monorepo 上的串行基座开发。`@open-doing/types` 承载可序列化类型与纯函数；web 包按 `features/` 领域划分 + `server/` 基础设施组织；写操作走 Server Actions 返回统一 `ActionResult<T>`；会话用 jose 无状态签名 cookie（不建 sessions 表）。

**Tech Stack:** Next.js 16.4.2 App Router + React 19 + TS strict + antd v6 + Tailwind 4（关 preflight）+ PostgreSQL/Drizzle + Vitest + jose + @node-rs/argon2

**Spec:** `docs/V1_TASKS.md` §2/§3/§5（本计划的唯一需求来源；冲突以它为准）+ `docs/ARCHITECTURE.md` + `docs/prototypes/README.md`（主题令牌映射表）

## Global Constraints

- Next.js **16.4.2** 有破坏性变更：动 web 包代码前先读 `apps/web/node_modules/next/dist/docs/` 相关指南（`cookies()` 是 async、`params` 是 Promise 等），不要凭旧版经验。
- 认证只用用户名+密码，无邮箱；UID 格式 `doing_xxxxxx`；日期只用 `date`（YYYY-MM-DD 字符串）；逾期=今天>due 且非 done；临期=due∈{今天,明天}；统一 Asia/Shanghai 口径。
- 类型与纯函数零 IO、零 React、不传 `Date`/时区（today 由调用方注入）。
- 删除=硬删除+级联（外键 `ON DELETE CASCADE` 兜底）。
- 依赖一次装齐（F-2）；此后 M0 内不再新增任何依赖。
- 样式颜色只取令牌（来自 `docs/prototypes/assets/design-tokens.css` 映射表）；Tailwind 不覆盖 antd 内部样式。
- 中文文案、中文注释；**commit message 一律英语**；每个任务以 `pnpm -r typecheck && pnpm lint && pnpm -r test && pnpm build` 全绿收尾。
- 工作目录是 worktree `…/open-doing/initial`（分支 `asher/initial`），所有命令在此目录执行；M0 在此分支上小步提交，合并 main + 打 `m0-frozen` 由集成负责人在出口做（不在本计划内）。

## Review Focus

规格暗示但单任务测试最难覆盖、最易咬人的五类输入：

1. **时区漂移**：`isDueSoon` 的"明天"计算若走本地时区，跨日/跨时区机器会错。→ Task 1 用 UTC 天算术并有 `2026-10-21→2026-10-22` 断言。
2. **除零**：空子任务数组、空项目进度必须返回 0 而非 NaN。→ Task 1 断言 `getTaskProgress(空数组) === 0`、`aggregateProjectProgress([], 0) === 0`。
3. **级联与部分唯一索引是否真生效**：契约靠 DB 兜底，若索引漏建则 M2 后静默出错。→ Task 3 schema 测试连真实 PG 验证级联与两处部分唯一索引、CHECK 约束。
4. **Tailwind preflight 污染 antd 样式 / antd SSR 闪烁**：→ Task 4 用临时演示页（Button/Input/Table/Modal）目测验证后删除，并在 Task 7 全量 build 复核。
5. **会话安全属性与路由守卫遗漏**：cookie 非 httpOnly、`(dashboard)` 漏守卫。→ Task 6 服务层测试 + `(dashboard)/layout.tsx` 统一 `requireUser`（唯一守卫点）。

---

### Task 1: F-1 修订共享领域类型与纯函数

**Files:**
- Rewrite: `packages/types/src/index.ts`（改为 barrel 重导出）
- Create: `packages/types/src/progress.ts`、`packages/types/src/date.ts`
- Test: `packages/types/src/index.test.ts`

**Interfaces:**
- Consumes: 无（最底层）。
- Produces（M0 后全仓只依赖这些名字，与 V1_TASKS §3 逐字一致）:
  - 类型：`User { id, uid, username, createdAt }`、`Team { id, name, slug, ownerId, createdAt }`、`TeamMembership { id, teamId, userId, role: 'owner'|'admin'|'member', joinedAt }`、`TeamInvite { id, teamId, inviteeId, invitedById, status: 'pending'|'accepted'|'declined'|'rescinded', createdAt, respondedAt? }`、`Project { id, teamId: string|null, ownerId: string|null, name, slug, description?, createdAt }`、`Task { id, projectId: string|null, spaceType, title, description?, status, assigneeId: string|null, dueDate?: string, createdAt, updatedAt }`、`Subtask { id, taskId, title, completed, createdAt, completedAt? }`（无 assigneeId）、`Comment { id, taskId, authorId, content, createdAt }`、`Notification { id, userId, type, read, teamId?, projectId?, taskId?, actorId?, createdAt }`、`TaskStatus`、`SpaceType`、`NotificationType`
  - 所有时间戳字段类型为 `string`（可序列化 ISO）；`dueDate` 为 `YYYY-MM-DD` 字符串
  - 函数：`getTaskProgress(input: { status: TaskStatus; subtasks: { completed: boolean }[] }): number`、`aggregateProjectProgress(taskProgresses: number[], taskCount: number): number`、`isOverdue(dueDate: string, status: TaskStatus, today: string): boolean`、`isDueSoon(dueDate: string, status: TaskStatus, today: string): boolean`

- [ ] **Step 1: 写失败测试** `packages/types/src/index.test.ts`（vitest，node 环境），断言：
  - `getTaskProgress`: 5 子任务完成 3 = `0.6`；空数组 + `todo` = `0`（非 NaN）；无子任务时 `todo`/`in_progress`/`done` = `0/0.5/1`
  - `aggregateProjectProgress`: `([], 0)` = `0`；`([0.6, 0.2, 1], 3)` = `0.6`；`([0.5], 1)` = `0.5`
  - `isOverdue/isDueSoon` 以 `today = "2026-10-21"`：`"2026-10-20"` 未完成 → 逾期 true/临期 false；`"2026-10-21"` 未完成 → 临期 true/逾期 false；`"2026-10-22"` 未完成 → 临期 true；`"2026-10-21"` 已完成 → 两者皆 false；`"2026-10-19"` → 两者皆 false
- [ ] **Step 2: 跑测试确认失败**：`pnpm --filter @open-doing/types test` → FAIL（新函数不存在）
- [ ] **Step 3: 实现**
  - `date.ts`：`isOverdue` = `status !== "done" && today > dueDate`（YYYY-MM-DD 字符串字典序即日期序）；`isDueSoon` = 非 done 且 `dueDate === today || dueDate === addDays(today, 1)`；导出 `addDays(date: string, days: number): string`（用 UTC 毫秒算术 `Date.UTC` 解析/格式化，绝不用本地时区）。
  - `progress.ts`：按 Interfaces 签名实现；`aggregateProjectProgress` 当 `taskCount <= 0 || taskProgresses.length === 0` 返回 0，否则 `sum / taskProgresses.length`（JSDoc 注明 `taskCount` 为项目总任务数、调用方须保证与数组等长，函数仅用其判空）。
  - `index.ts`：删旧模型，barrel 重导出 `progress.ts`/`date.ts` 与全部类型；保留中文模块注释说明"可序列化类型 + 纯函数，无 IO/无 React"。
- [ ] **Step 4: 跑测试确认通过**：`pnpm --filter @open-doing/types test` → PASS；`pnpm --filter @open-doing/types typecheck` → 绿
- [ ] **Step 5: Commit**：`git add packages/types && git commit -m "feat(types): rewrite domain model per v1 contract"`

### Task 2: F-2 测试设施与全部依赖预装

**Files:**
- Create: `vitest.config.ts`（仓库根）
- Modify: 根 `package.json`、`packages/types/package.json`、`apps/web/package.json`、`pnpm-workspace.yaml`（如需 ignoredBuiltDependencies 增项）

**Interfaces:**
- Produces: 根命令 `pnpm test` / `pnpm test:run`；web 侧测试统一走根 vitest projects 中的 `web` project（`@` alias 已配好）；依赖清单冻结（见 Step 3），M0 后任何轨道不得改 package.json。

- [ ] **Step 1: 装依赖（一次装齐）**
  ```bash
  pnpm add -w -D vitest @vitest/coverage-v8
  pnpm --filter @open-doing/web add antd@^6 @ant-design/nextjs-registry dayjs drizzle-orm postgres jose @node-rs/argon2 @dnd-kit/core @dnd-kit/sortable @dnd-kit/utilities
  pnpm --filter @open-doing/web add -D drizzle-kit
  ```
  若 `@node-rs/argon2`/`antd@6` 等 postinstall 被拦截，按 pnpm 提示补 `ignoredBuiltDependencies`/`onlyBuiltDependencies`。
- [ ] **Step 2: 建 vitest workspace** 根 `vitest.config.ts`：
  ```ts
  import { defineConfig } from "vitest/config";
  import path from "node:path";

  export default defineConfig({
    test: {
      projects: [
        { test: { name: "types", include: ["packages/types/src/**/*.test.ts"], environment: "node" } },
        {
          resolve: { alias: { "@": path.resolve(import.meta.dirname, "apps/web/src") } },
          test: { name: "web", include: ["apps/web/src/**/*.test.ts"], environment: "node" },
        },
      ],
    },
  });
  ```
  根 `package.json` scripts 加 `"test": "vitest run"`、`"test:run": "vitest run"`；`packages/types/package.json` 加 `"test": "vitest run"`（在其目录内跑默认 include 即可命中自身测试）。约定：涉及 DB 的测试用 `TEST_DATABASE_URL`（指向 `open_doing_test`），无库时 `describe.skipIf` 跳过并在模块顶部 `console.warn` 提示——该 helper 在 Task 3 落地。
- [ ] **Step 3: 全链路验证**：`pnpm test`（Task 1 的 types 测试通过）→ `pnpm typecheck && pnpm lint && pnpm build` 全绿
- [ ] **Step 4: Commit**：`git commit -am "chore: add vitest workspace and preinstall all v1 dependencies"`

### Task 3: F-3 Postgres + Drizzle 全量 schema 与首个迁移

**Files:**
- Create: `docker-compose.yml`（仓库根）、`docker/initdb/01-create-test-db.sh`、`.env.example`（仓库根）、`apps/web/src/server/db/schema.ts`、`apps/web/src/server/db/client.ts`、`apps/web/src/server/db/testing.ts`、`apps/web/drizzle.config.ts`、`apps/web/drizzle/0000_*.sql`（生成）、`apps/web/src/lib/uid.ts`、`apps/web/src/features/notifications/service.ts`、`apps/web/src/app/api/notifications/route.ts`
- Test: `apps/web/src/lib/uid.test.ts`、`apps/web/src/server/db/schema.test.ts`
- Modify: `apps/web/package.json`（db:generate/db:migrate 脚本）

**Interfaces:**
- Consumes: `@open-doing/types` 的 `NotificationType`。
- Produces:
  - `db`（`src/server/db/client.ts` 单例 drizzle 实例）与 `export type DbClient = typeof db`（事务 client 与之结构兼容，直接作参数类型）
  - `generateUid(): string`（`doing_` + 6 位小写字母数字，剔除易混淆字符 `i l o 0 1`）
  - `createNotification(input: CreateNotificationInput, client?: DbClient): Promise<void>`，其中 `interface CreateNotificationInput { userId: string; type: NotificationType; read?: boolean; teamId?: string | null; projectId?: string | null; taskId?: string | null; actorId?: string | null }`——桩实现：仅向 `notifications` 表 INSERT（用传入 client，缺省 `db`），无任何业务规则；**签名与路径自此冻结**，M1 起 T/J/G 直接 import 调用
  - `GET /api/notifications` 桩：恒返回 `NextResponse.json({ ok: false }, { status: 401 })`（N 轨道 M2 替换实现）

- [ ] **Step 1: 写失败测试** `uid.test.ts`：`generateUid()` 匹配 `/^doing_[a-z2-9]{6}$/` 且不含 `i/l/o/0/1`；连续 500 次调用互不相同。`schema.test.ts`（`describe.skipIf(!process.env.TEST_DATABASE_URL)`）：见 Step 3 的 6 组断言
- [ ] **Step 2: 跑测试确认失败**：`pnpm test` → FAIL（模块不存在）
- [ ] **Step 3: 实现 schema 与基础设施**，关键决策按此定稿：
  - 全部主键 `uuid().primaryKey().defaultRandom()`；外键级联：`projects.team_id→teams`/`projects.owner_id→users`、`tasks.project_id→projects`、`subtasks.task_id`、`comments.task_id`、`notifications.user_id/team_id/project_id/task_id` 均 `onDelete: "cascade"`；`tasks.assignee_id→users` 用 `"set null"`；`comments.author_id`、`tasks.created_by_id`、`notifications.actor_id→users` 用 `"cascade"`（v1 不删账号，仅兜底）。
  - `projects`：CHECK `((team_id IS NOT NULL) <> (owner_id IS NOT NULL))`；部分唯一索引 `UNIQUE(team_id, slug) WHERE team_id IS NOT NULL`、`UNIQUE(owner_id, slug) WHERE owner_id IS NOT NULL`。
  - `team_invites`：部分唯一索引 `UNIQUE(team_id, invitee_id) WHERE status = 'pending'`。
  - `notifications`：部分唯一索引 `UNIQUE(user_id, task_id, type) WHERE task_id IS NOT NULL`（N-3 幂等依赖）+ 普通索引 `(user_id, read)`。
  - 查询索引一次建齐：`tasks(assignee_id)`、`tasks(status, due_date)`、`tasks(space_type)`、`team_memberships(user_id)`、`projects(owner_id)`；`tasks.due_date` 用 `date({ mode: "string" })`。
  - `teams.slug` 定为**全局唯一**（单列 unique）；个人任务 `assignee_id 恒为本人` 选择**应用层 service 断言**（不建触发器），此决策写入 schema.ts 顶部注释。
  - `client.ts`：`postgres(TEST_DATABASE_URL || DATABASE_URL)` + `drizzle`，`globalThis` 缓存单例防热重载多连接；导出 `db`、`DbClient`。
  - `testing.ts`：导出 `setupTestDb()`——用 drizzle `migrator` 对测试库跑 `./drizzle` 迁移（顺带验证迁移可重放）后 `TRUNCATE` 全部表 CASCADE，返回 db 实例；schema.test.ts 六组断言：① username/uid 唯一约束拒绝重复；② projects CHECK 拒绝 teamId/ownerId 双填；③ pending 邀请部分唯一拒绝同 (team, invitee) 二次 pending；④ 通知幂等索引拒绝同 `(user_id, task_id, type)` 二次插入；⑤ 删项目级联清空 tasks/subtasks/comments/notifications；⑥ 删团队级联清空 memberships/invites/projects。
  - `docker-compose.yml`：`postgres:17-alpine`，`POSTGRES_USER/PASSWORD: open-doing`，`POSTGRES_DB: open_doing`，端口 5432，数据卷 + 挂载 `docker/initdb/`；init 脚本 `CREATE DATABASE open_doing_test`。`.env.example` 列 `DATABASE_URL/TEST_DATABASE_URL/SESSION_SECRET/CRON_SECRET`（值按 ARCHITECTURE §11）。web `package.json` 加 `"db:generate": "drizzle-kit generate"`、`"db:migrate": "drizzle-kit migrate"`；`drizzle.config.ts` 指向 `src/server/db/schema.ts`、`out: "./drizzle"`。
  - 实现 `uid.ts`（node `crypto.randomBytes`）与 `createNotification` 桩、`/api/notifications` 401 桩。
- [ ] **Step 4: 跑迁移与测试**：`docker compose up -d` → `psql` 建 `open_doing_test`（或由 init 脚本）→ `pnpm --filter @open-doing/web db:generate && db:migrate` → `pnpm test` 全 PASS（无库时 DB 用例显示 skipped 且有 warn）
- [ ] **Step 5: 迁移可重放验证**：`psql` drop 再建 `open_doing_test`，重跑 `db:migrate` + 测试 → PASS
- [ ] **Step 6: Commit**：`git add -A && git commit -m "feat(db): add full drizzle schema, migrations, uid generator and notification service stub"`

### Task 4: F-4 antd v6 + 主题令牌接入

**Files:**
- Create: `apps/web/src/app/theme.ts`、`apps/web/src/app/providers.tsx`
- Modify: `apps/web/src/app/layout.tsx`、`apps/web/src/app/globals.css`
- 临时：`apps/web/src/app/demo/page.tsx`（验证后删除）

**Interfaces:**
- Produces: `Providers`（root layout 专用包裹：AntdRegistry + ConfigProvider `locale={zh_CN}` + `theme={antdTheme}`，并 `dayjs.locale("zh-cn")`）；`src/app/theme.ts` 导出 `antdTheme: ThemeConfig`。F-5 起所有页面经此获得主题与中文 locale，不得再自建 ConfigProvider。

- [ ] **Step 1: 实现 theme.ts**，token 逐项取自 `docs/prototypes/README.md` 映射表：`colorPrimary #7d2ae8`；`colorSuccess/Warning/Error/Info #00b894/#ffb020/#ff5757/#0d99ff`；`colorBgLayout #f4f5f7`；`colorBorder/colorBorderSecondary #c7cdd3/#e1e3e6`；`borderRadius/borderRadiusLG 8/12`；`fontFamily '"Canva Sans","YS Text",system-ui,-apple-system,"PingFang SC","Microsoft YaHei",sans-serif'`；`boxShadow/boxShadowSecondary '0 1px 3px rgba(14,19,24,.04)'/'0 8px 24px rgba(14,19,24,.08)'`；`controlHeight 38`。品牌渐变不进 antd 主题（后续用 className）。
- [ ] **Step 2: 实现 providers.tsx**（`"use client"`）：AntdRegistry 包 ConfigProvider；模块顶部 `import dayjs; import "dayjs/locale/zh-cn"; dayjs.locale("zh-cn");`
- [ ] **Step 3: 改 globals.css 与 layout.tsx**：globals.css 改为
  ```css
  @import "tailwindcss/theme.css" layer(theme);
  @import "tailwindcss/utilities.css" layer(utilities);
  ```
  **不引 preflight/base**；删除深色媒体查询与 Arial body 样式；仅保留从令牌取值的 `body { background: var(--surface-subtle, #f4f5f7); color: …; font-family: … }`。layout.tsx：移除 Geist 字体，包 `<Providers>`，`lang="zh-CN"`，metadata 改「Open Doing」。
- [ ] **Step 4: 临时演示页验证**：`app/demo/page.tsx` 放 antd Button/Input/Table/Modal/DatePicker/Progress 各一（Modal 由 client 子组件触发），`pnpm dev` 目测：无样式闪烁、无 Tailwind 重置污染（按钮/标题未被重置）、DatePicker 周始于周一且文案中文、Modal/DatePicker 正常弹出。**验证通过后删除 demo 页**再提交。
- [ ] **Step 5: 全量检查 + Commit**：`pnpm typecheck && pnpm lint && pnpm build` 绿 → `git commit -m "feat(web): integrate antd v6 theme tokens, zh_CN providers and tailwind without preflight"`

### Task 5: F-5 应用外壳、导航桩与共享基础组件

**Files:**
- Create: `apps/web/src/components/layout/{AppShell,Sidebar,Topbar,SpaceSwitcher,NavSection}.tsx`、`apps/web/src/components/ui/{UserAvatar,StatusTag,ProgressBar,ConfirmModal,EmptyState,DueText}.tsx`、`apps/web/src/features/notifications/components/NotificationBell.tsx`、`apps/web/src/features/personal/components/PersonalNav.tsx`、`apps/web/src/features/teams/components/TeamsNav.tsx`、`apps/web/src/app/(dashboard)/layout.tsx`、`apps/web/src/app/(dashboard)/page.tsx`、`apps/web/src/app/(dashboard)/my/page.tsx`、`apps/web/src/app/(auth)/layout.tsx`、`apps/web/src/app/not-found.tsx`
- 保留目录占位文件随组件落地删除（.gitkeep）

**Interfaces:**
- Produces（后续轨道只消费、不改 layout）:
  - `AppShell(props: { personalNav: ReactNode; teamsNav: ReactNode; user: User | null; children: ReactNode })`——侧栏含 Logo + SpaceSwitcher + `NavSection`（渲染 personalNav 与 teamsNav 两段）；`user` 传给 Topbar 头像区，F-6 前传 null
  - `Topbar(props: { user: User | null })`：禁用态搜索框 + `<NotificationBell />` 占位（`features/notifications/components/NotificationBell.tsx`，现渲染 `return null`，N-2 原路径替换）
  - `PersonalNav.tsx` / `TeamsNav.tsx`：返回占位节点的最简组件——**layout 只 import 这两个固定路径**；M0 后所有权 P（P-5）/ T（T-1）
  - 6 个 ui 组件 props 定稿（各写 JSDoc）：`UserAvatar({ username: string; size?: number })`（首字 + 由用户名哈希从 6 个 accent 点缀色取色）；`StatusTag({ status: TaskStatus })`（未开始/进行中/已完成）；`ProgressBar({ value: number })`（0~1，内部 ×100）；`ConfirmModal({ open, title, content, confirmText?, danger?, loading?, onConfirm, onCancel })`；`EmptyState({ title, description?, action? })`；`DueText({ dueDate?: string; status: TaskStatus; today: string })`（内部用 `isOverdue/isDueSoon`，逾期红/临期黄/普通灰）
- Consumes: `@open-doing/types`（Task 1）、主题（Task 4）。

- [ ] **Step 1: 实现布局组件**：参考 `docs/prototypes/my-tasks.html` 外壳；侧栏 `hidden min-[861px]:flex`（≤860px 整体隐藏）；SpaceSwitcher 按 README 原型渲染静态菜单（个人空间/我的团队/创建团队，暂为占位交互）；NavSection 为通用分组容器（标题 + children）。页面骨架用 Tailwind 原子类，不覆盖 antd 内部样式。
- [ ] **Step 2: 实现 6 个 ui 组件与 NotificationBell/两个导航桩**（签名如 Interfaces，全部为 `"use client"` 或纯展示按需标注；antd 组件所在文件必须 `"use client"`）
- [ ] **Step 3: 建路由骨架**：`(dashboard)/layout.tsx` 渲染 `<AppShell personalNav={<PersonalNav />} teamsNav={<TeamsNav />} user={null}>`（F-6 接 `requireUser`）；`(dashboard)/page.tsx` `redirect("/my")`；`(dashboard)/my/page.tsx` 最简占位页**展示 6 个组件的最小 demo 状态**（D-1 整体替换）；`(auth)/layout.tsx` 居中 + 品牌渐变侧板骨架（对照 login.html 左侧品牌栏）；根 `not-found.tsx` 用 antd Result 404 风格。
- [ ] **Step 4: 验证**：`pnpm dev` 后用 Playwright（或浏览器）在 1440 与 375 宽度各截屏确认无横向溢出；未命中路由显示 404；`(dashboard)` 与 `(auth)` 布局分离
- [ ] **Step 5: Commit**：`git commit -am "feat(web): add app shell, nav stubs, notification placeholder and shared ui components"`

### Task 6: F-6 认证与会话、路由守卫

**Files:**
- Create: `apps/web/src/features/auth/{session,service,actions}.ts`、`apps/web/src/features/auth/components/{LoginForm,RegisterForm}.tsx`、`apps/web/src/features/users/service.ts`、`apps/web/src/app/(auth)/login/page.tsx`、`apps/web/src/app/(auth)/register/page.tsx`
- Modify: `apps/web/src/app/(dashboard)/layout.tsx`（接 `requireUser`）、`docs/ARCHITECTURE.md` §3 决策表
- Test: `apps/web/src/features/auth/service.test.ts`、`apps/web/src/features/auth/session.test.ts`

**Interfaces:**
- Consumes: `db/DbClient`、`generateUid`（Task 3）、`User`（Task 1）。
- Produces:
  - `getCurrentUser(): Promise<User | null>` / `requireUser(): Promise<User>`（未登录 `redirect("/login")`）——`features/auth/session.ts`
  - `registerUser(input: { username: string; password: string }): Promise<User>`；`login(input: { username: string; password: string }): Promise<User>`；`logout(): Promise<void>`——`features/auth/service.ts`；错误以领域错误类抛出（如 `AuthError(code, message)`），由 actions 映射为 `ActionResult` 字段错误
  - Server Actions：`registerAction` / `loginAction` / `logoutAction`，返回 `ActionResult<User | true>`：`{ ok: true; data } | { ok: false; errors: Record<string, string> }`（`ActionResult` 类型定义在 `features/auth/actions.ts` 并导出，供全仓复用）
  - `findByUid(uid: string): Promise<User | null>`（T-2 消费）、`getUserById(id: string): Promise<User | null>`
- 会话决策（已定，写入实现与 ARCHITECTURE §3 理由列）：jose HS256 签名无状态 httpOnly cookie（名 `od_session`，`sameSite: "lax"`，prod `secure: true`，30 天，payload `{ userId }`，`SESSION_SECRET` 环境变量）+ `@node-rs/argon2` Argon2id 哈希；不建 sessions 表。

- [ ] **Step 1: 写失败测试** `service.test.ts`（连 `TEST_DATABASE_URL`，`setupTestDb` 前置；无库 skip）：
  - 注册成功返回带 `doing_` 前缀 UID 的 User；用户名重复 → 抛"用户名已存在"类错误
  - UID 碰撞重试：`vi.mock("@/lib/uid")` 让 `generateUid` 先返回库中已存在 UID 再返回新值，注册仍成功（重试路径生效）
  - 登录：错误密码、不存在的用户名均抛同一"用户名或密码错误"错误（不泄露存在性）；正确密码返回 User
  - `session.test.ts`：jose 签名/验签往返（伪造 secret 的 token 验签失败）；cookie 属性常量断言（httpOnly/sameSite/maxAge）
- [ ] **Step 2: 跑测试确认失败**：`pnpm test` → FAIL
- [ ] **Step 3: 实现**
  - 先读 `apps/web/node_modules/next/dist/docs/` 中 cookies 与 Server Actions 指南（`cookies()` 为 async）。
  - `session.ts`：`createSession(userId)`（SignJWT + cookieStore.set）、`getSessionUserId()`、`clearSession()`、`getCurrentUser`/`requireUser`。
  - `service.ts`：注册校验（用户名 2–20 字符、密码 ≥8 位，规则与中文文案对照 register 原型）；用户名查重友好报错；argon2 哈希；`generateUid` 冲突时依赖 DB 唯一约束重试（≤5 次）；登录恒定错误文案。
  - `actions.ts`：`"use server"`，调 service、写/清 cookie、映射 `AuthError` → `{ ok: false, errors: { username?/password?/form: 中文 } }`。
  - 页面：login/register 复刻原型两屏（`(auth)` 布局的品牌侧板 + antd Form 表单）；表单提交调 action，失败展示字段错误，成功 `router.push("/my")`；`(auth)/layout.tsx` 对已登录用户 `redirect("/my")`；`(dashboard)/layout.tsx` 改为 `const user = await requireUser()` 并把 user 传给 `AppShell`/`Topbar`。
  - `docs/ARCHITECTURE.md` §3「认证」行理由列补：jose 无状态签名 cookie（无 sessions 表，免查库/免清理）+ @node-rs/argon2（Argon2id，原生性能）。
- [ ] **Step 4: 跑测试确认通过**：`pnpm test` 全 PASS
- [ ] **Step 5: 手工验证**：`pnpm dev` 注册→登出→登录→访问 `/my`；未登录访问 `/my` 跳 `/login`；已登录访问 `/login` 跳 `/my`
- [ ] **Step 6: Commit**：`git commit -am "feat(auth): add username/password auth, stateless jose session and route guards"`

### Task 7: M0 出口检查（冻结点准备）

**Files:**
- Modify: `README.md`（本地开发 Quickstart）、`docs/V1_TASKS.md`（勾选 F-1~F-6 验收项、状态表 F 行标 ✅）

- [ ] **Step 1: README Quickstart**：clone → `pnpm install` → `docker compose up -d` → 复制 `.env.example` 为 `apps/web/.env.local` 并填 `DATABASE_URL/SESSION_SECRET` → `pnpm --filter @open-doing/web db:migrate` → `pnpm dev` → 注册登录。写明测试库 `open_doing_test` 用法与 `pnpm test`。
- [ ] **Step 2: 全量收尾验证**：干净 checkout（`git stash` 不可用，用 `git worktree add` 临时目录或 CI 思维在当前树确认无未提交改动）跑 `pnpm -r typecheck && pnpm lint && pnpm -r test && pnpm build` 全绿；`docker compose down -v && up -d` 后按 README 从零走通起库/迁移/注册/登录。
- [ ] **Step 3: Commit**：`git commit -am "docs: add local development quickstart and check off M0 tasks"`
- [ ] **Step 4: 汇报冻结点**：告知用户可评审；合 main + `git tag m0-frozen` + 各轨道拉 worktree 由集成负责人执行（V1_TASKS §4.1），不在本计划内。

---

## Self-Review 记录

- **Spec 覆盖**：V1_TASKS §5 F-1~F-6 每条验收项均映射到任务步骤；§3 契约签名逐字落入 Task 1/3 Interfaces；§4.1 的依赖冻结、`.env.local` 不入库（`.env.example` 入库）已含。
- **类型一致性**：`DbClient`（Task 3）→ Task 6 事务参数；`User`（Task 1）→ Task 5 `AppShell/Topbar`、Task 6 返回值；`ActionResult`（Task 6 定义）为后续轨道消费点，路径 `features/auth/actions.ts` 已定。
- **Review Focus 各项**已落入 Task 1（时区/除零）、Task 3（级联/部分唯一）、Task 4（样式污染）、Task 6（会话属性/守卫）的测试或验证步骤。
- **比例**：计划只固定签名、测试断言与命令，未转录实现体。
