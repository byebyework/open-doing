# Open Doing v1 开发任务板

日期：2026-10-22
依据：[2026-10-21-open-doing-v1-design.md](./2026-10-21-open-doing-v1-design.md)（产品"是什么"）、[ARCHITECTURE.md](./ARCHITECTURE.md)（"怎么搭"）、[prototypes/](./prototypes/)（长什么样）

本文件是 v1 的**任务板与并行开发排程**：每个任务是一个可独立评审、独立合并的交付物。开始任务前先读三份依据；任务与设计冲突时以设计文档为准并回来更新本文件。

## 状态与用法

- 任务状态直接勾选 checkbox；开始开发时把任务行的状态标记改为 `[~]` 并填负责人。
- 任务 ID：`F` = 基座（Foundation），`P` = 个人空间，`T` = 团队与邀请，`J` = 团队项目与任务，`N` = 通知与 cron，`D` = 聚合仪表盘，`G` = 团队治理，`X` = 收尾。
- 标注：尺寸 S/M/L（约 0.5 / 1–2 / 3+ 人日）；`Depends` 为前置任务。
- 每条轨道的文件目录互斥（见 §4），除"共享契约变更"外不允许改其他轨道的目录。

| 轨道 | 名称 | 波次 | 负责人 | 状态 |
|---|---|---|---|---|
| F | 基座（串行） | M0 | | ✅ |
| P | 个人空间 | M1 | | ✅ |
| T | 团队 / 邀请 / 角色 | M1 | asher | ✅ |
| J | 团队项目与任务 | M2（Depends T） | asher | ✅ |
| N | 通知与 cron | M2（接口 M0 冻结） | asher | ✅ |
| D | 聚合仪表盘 | M3（Depends P/J） | asher | ✅ |
| G | 团队治理 | M3（Depends T/J） | asher | ✅ |
| INT | 波次集成（单一集成负责人） | 每波次末 | | 🟡 |
| X | 收尾与发布 | M4 | asher | ✅ |

状态图例：⬜ 未开始 / 🟡 进行中 / ✅ 完成

## 1. 里程碑与并行拓扑

```
M0 基座（串行，必须先全部完成）
 F1 领域类型与纯函数 → F2 测试设施 → F3 DB/schema → F4 antd/主题 → F5 应用外壳 → F6 认证与会话
                                          │
              ┌───────────────────────────┴───────────────────────────┐
M1 并行波次 1（从 m0-frozen 拉 worktree）
                ▼                                                        ▼
        P 个人空间（个人项目/任务/我的任务页）                    T 团队/UID 邀请/角色
              │                                                        │
              └─────────────────────────────┬──────────────────────────┘
                                            ▼
                                INT-1 集成 → 合并 main，打 m1 基线 tag
              ┌───────────────────────────────────────────────────────┐
M2 并行波次 2（从 m1-frozen 拉 worktree）
        ▼                                                       ▼
                 J 团队项目与任务                          N 通知中心 + cron
                             │                                         │
                             └──────────────────┬──────────────────────┘
                                                ▼
                                    INT-2 集成 → 合并 main，打 m2 基线 tag
M3 并行波次 3（从 m2-frozen 拉 worktree）
                             ▼                                         ▼
                       D 聚合仪表盘（我的任务聚合/团队概览）      G 治理（移除/退出/转让/解散/删项目）
                             │                                         │
                             └──────────────────┬──────────────────────┘
                                                ▼
                                    INT-3 集成 → 合并 main，打 m3 基线 tag
M4                                                                      ▼
        X 端到端走查、空状态/错误态、响应式与 a11y、seed、部署说明
```

- **里程碑定义**
  - **M0**：`pnpm dev` 可登录，看到真实主题的空外壳；DB 迁移可跑；共享契约（§3）全部冻结。
  - **M1**：单人闭环——注册、管理个人项目与任务；能创建团队并完成一次 UID 邀请接受全流程。
  - **M2**：团队协作闭环——团队项目、指派、看板、通知与到期提醒。
  - **M3**：主管视角与生命周期管理全部可用，达到 v1 功能完整。
  - **M4**：质量收尾，达到可演示/可部署。

- **4 人并行建议**：M0 由 1 人串行（或结对）；M1 起 2 人 P/T；M2 起加人开 N、J；M3 四条线可同时收尾。人少时按 P→T→J→D→N→G→X 顺序串行亦可，依赖关系已给出。
- 每个波次出口 = 集成负责人完成 INT 任务、合入 main 并打下一个基线 tag（见 §4.1）；轨道分支不在波次中途互相合并。

## 2. 全局约束（每个任务的隐含要求）

- Next.js **16.4.2** 有破坏性变更：写代码前先读 `apps/web/node_modules/next/dist/docs/` 中相关指南（App Router / Server Actions / caching / route handlers），不要凭旧版经验。
- 技术栈固定：Next.js 16 App Router + React 19 + TypeScript strict + antd **v6**（`@ant-design/nextjs-registry`，`ConfigProvider` 注入 `zh_CN` + dayjs 中文 locale，亮色主题）+ Tailwind CSS 4 **关闭 preflight** + PostgreSQL + Drizzle ORM。
- 认证只用**用户名 + 密码**，不收集邮箱；UID 格式 `doing_xxxx`，仅用于邀请；v1 无密码找回。
- 日期：截止日期仅日期（Postgres `date`，YYYY-MM-DD 展示）；**截止日当天不算逾期，次日起算**；临期 = 今天/明天；已完成不计逾期/临期；统一 **Asia/Shanghai** 口径。
- 进度口径：有子任务 = 完成数/总数；无子任务 = 状态映射 0/0.5/1；项目/团队进度都是**简单平均**（空 = 0），个人项目不参与团队聚合。
- 删除：团队/项目均为**硬删除 + 级联**（DB 外键 `ON DELETE CASCADE` 兜底，UI 二次确认）；成员离开只删成员关系，其任务 `assignee` 置空。
- 写操作只走 **Server Actions**，返回统一 `ActionResult<T>`；不做公开 REST API（cron Route Handler 除外）。每个 action 独立鉴权，不靠隐藏按钮。
- 页面保持 RSC 取数；antd 交互件（Modal/Form/Table 交互/message/拖拽）下沉为 `"use client"` 组件，序列化数据经 props 传入。
- 样式：颜色只允许取令牌（先冻结 `assets/design-tokens.css` → `theme.ts`），Tailwind 不覆盖 antd 内部样式，不写全局选择器硬改。
- 中文文案、中文注释密度与现有代码一致；commit message 一律**英语**。
- 桌面端优先但不得在 375px 宽度横向溢出（参考原型移动端规则：表格卡内横滚、页头纵向堆叠）。
- 每个任务自带测试（单元/服务层）并以 `pnpm --filter <pkg> test` / `typecheck` / `lint` / `build` 全绿收尾。

## 3. 共享契约（M0 结束时冻结，跨轨道只依赖这些名字）

> 以下签名在 F 线落地；后续轨道只消费，需要改动时在任务板上提出，不允许私自改签名。

**`@open-doing/types`（可序列化类型 + 纯函数，无 IO/无 React）**

```ts
// 身份与空间
User { id, uid, username, createdAt }                 // 无 email；username 即显示名
Team { id, name, slug, ownerId, createdAt }
TeamMembership { id, teamId, userId, role: 'owner'|'admin'|'member', joinedAt }
TeamInvite { id, teamId, inviteeId, invitedById, status: 'pending'|'accepted'|'declined'|'rescinded', createdAt, respondedAt? }
Project { id, teamId: string|null, ownerId: string|null, name, slug, description?, createdAt }
Task { id, projectId: string|null, spaceType: 'personal'|'team', title, description?, status: TaskStatus, assigneeId: string|null, dueDate?: string /* YYYY-MM-DD */, createdAt, updatedAt }
Subtask { id, taskId, title, completed, createdAt, completedAt? }   // 无责任人/截止日期
Comment { id, taskId, authorId, content, createdAt }
Notification { id, userId, type, read, teamId?, projectId?, taskId?, actorId?, createdAt }

type TaskStatus = 'todo' | 'in_progress' | 'done'
type NotificationType = 'team_invite' | 'task_assigned' | 'task_due_soon' | 'task_overdue' | 'task_commented' | 'task_changed_by_admin'

// 纯函数
getTaskProgress(input: { status: TaskStatus; subtasks: { completed: boolean }[] }): number
aggregateProjectProgress(taskProgresses: number[], taskCount: number): number  // 空数组=0；直接平均入参
isOverdue(dueDate: string, status: TaskStatus, today: string): boolean          // today>dueDate 且非 done
isDueSoon(dueDate: string, status: TaskStatus, today: string): boolean          // due∈{今天,明天} 且非 done
```

**web 包服务侧（`src/server/`、`src/features/`）**

```ts
type ActionResult<T> = { ok: true; data: T } | { ok: false; errors: Record<string, string> }

getCurrentUser(): Promise<User | null>                  // features/auth
requireUser(): Promise<User>                            // 未登录 redirect('/login')
getMembership(teamId: string, userId: string): Promise<TeamMembership | null>
assertCan(/* action, actor, resource */): Promise<void> // 失败抛权限错误 → 403 页

createNotification(input: {...}): Promise<void>         // features/notifications，M2 前 J/T/G 按此签名先写调用
```

**侧栏契约（F5 落地接口，P/T 各填一段）**：dashboard layout 接收 `{ personal: ReactNode; teams: ReactNode[] }` 两段导航节点；P 轨道提供个人段（我的任务 + 个人项目列表），T 轨道提供团队段（团队列表 + 团队内项目）。空间切换器原型已定义交互，静态部分 F5 做、数据由 P/T 接入。

**通知角标契约**：顶栏渲染未读数；F5 预留 `<NotificationBell />` 组件位，N 轨道实现，通过轮询 route handler（N 轨道自建，非业务 API 例外）取未读数。

## 4. 文件所有权矩阵（避免并行冲突）

| 路径 | 所有轨道 | 其他轨道 |
|---|---|---|
| `packages/types/**` | F（冻结后变更须全组同意） | 只读消费 |
| `src/server/db/**`、`drizzle/**`、`docker-compose.yml` | F；后续 schema 变更集中为独立任务并周知 | 不提迁移 |
| `src/app/theme.ts`、`src/app/providers.tsx`、`globals.css` | F | 不改 |
| `src/components/layout/**`、`src/app/(dashboard)/layout.tsx` | F（M0 后冻结） | **任何轨道不得再改**；导航一律改两个桩文件 |
| 导航桩 `features/personal/components/PersonalNav.tsx` | F 播种 → P（P-5 接线） | 只渲染，不改结构 |
| 导航桩 `features/teams/components/TeamsNav.tsx` | F 播种 → T（T-1 接线）→ **J（J-1 例外：单人开发，团队项目二级导航由 J 直接扩）** | 同上 |
| `src/features/auth/**`、`src/features/users/**` | F/T | 只读 `getCurrentUser` 等 |
| `src/features/personal/**`（新建目录，含个人项目/任务页面私有件） | P | 不碰 |
| `src/features/teams/**` | T、G（G 在 M3 接管治理部分） | J 只读权限函数 |
| `src/features/projects/**`、`src/features/tasks/**` | J（P 在 personal 目录自建，不改这里） | — |
| `src/features/notifications/**`、`src/app/api/**` | F-3 播种 service/route 桩 → **N**（M2 起接管全部实现） | 只调用 `createNotification`；按 N 的接线清单在自己文件里插调用 |
| 团队概览页 `src/app/(dashboard)/teams/[teamSlug]/page.tsx` | D | J/T 不写此文件 |
| 我的任务页 `src/app/(dashboard)/my/page.tsx` | F-5 播种占位 → **D**（D-1 整体替换；P 只提供个人侧数据访问函数） | — |

共享通用组件放 `src/components/ui/`，新增者在轨道 PR 中带上，其他人复用不重复造。

## 4.1 Worktree 并行工作流（本轮采用）

每个 worktree = 一条 track 长分支，从冻结点拉出，波次末由**单一集成负责人**合回 main 并打 tag，集成后删 worktree，下一波次从新 tag 重拉（不跨波次 rebase 旧分支）。

```bash
# M0 合入 main 后：
git tag m0-frozen
git worktree add ../od-personal -b track/personal m0-frozen
git worktree add ../od-teams    -b track/teams    m0-frozen
# M2：从 m1-frozen 拉 J/N；M3：从 m2-frozen 拉 D/G
```

- **基线 tag**：`m0-frozen` →（INT-1）`m1-frozen` →（INT-2）`m2-frozen` →（INT-3）`m3-frozen`。轨道分支只 rebase/merge 对应基线 tag，不合入其他 track 分支。
- **依赖安装**：每个 worktree 各跑一次 `pnpm install`（pnpm 全局 store 硬链接，成本低）；M0 后**禁止任何轨道自行加依赖**（全部依赖 F-2 预装），确需新增走集成负责人。
- **本地服务端口**（同一台机器并行开发）：P=3001、T=3002、J=3003、N=3004、D=3005、G=3006（`pnpm dev -p <port>`）。
- **数据库**：共享一个 Docker PG 容器，每轨道独立数据库 `open_doing_<track>`（如 `open_doing_personal`），各自跑迁移/seed，互不污染；`.env.local` 不入库。
- **提交节奏**：任务在 track 分支上小步提交（英语 message），一个任务一个 commit 或小 PR；波次末集成时只解决"接缝"（导航接线、通知接线、共享件复用），不重写业务代码。
- 用子代理执行任务时，让它直接在已 checkout 的 track worktree 目录里工作，不要另起临时 isolation worktree。

---

## 5. M0 基座（串行）

### F-1 修订共享领域类型与纯函数　`M`　Depends: —

- Files: `packages/types/src/index.ts`（重写）、`packages/types/src/progress.ts`、`date.ts`（新建，按纯函数拆分）、`packages/types/src/index.test.ts`
- 现状：`index.ts` 仍是旧模型（`email`/`token`/`expiresAt`、`Subtask.assigneeId`），整体按 §3 契约重写。
- 验收：
  - [x] 类型与 §3 完全一致；`dueDate` 为 `YYYY-MM-DD` 字符串而非 `Date`；`Project` 同时支持 `teamId` / `ownerId` 二选一。
  - [x] `getTaskProgress`：3/5 子任务完成 = 0.6；无子任务三态 = 0/0.5/1；空数组不除零。
  - [x] `isOverdue/isDueSoon` 以 `2026-10-21` 为 today：`2026-10-20` 未完成=逾期、`2026-10-21/22`=临期、`2026-10-21` 已完成=都不是。
  - [x] `pnpm --filter @open-doing/types typecheck` 通过；纯函数零依赖、不传 `Date`/时区（today 由调用方注入）。

### F-2 测试设施与全部依赖预装　`M`　Depends: F-1

- Files: `vitest.config.ts`（根级 workspace 模式覆盖两个包）、各 `package.json` 的 `test` 脚本、根 `package.json` 加 `test`/`test:run`
- 验收：
  - [x] 选定 **Vitest**；`pnpm -r test` 可跑通 types 单测；DB 相关用独立 PG 库（`open_doing_test`，连接串走 `TEST_DATABASE_URL`，跑前清空或事务回滚；无库时 skip 并打印提示）。
  - [x] **依赖一次装齐（关键并行约定）**：M0 内装好 v1 全部依赖——`vitest`+`@vitest/coverage-v8`；DB：`drizzle-orm`/`drizzle-kit`/`postgres`；会话与哈希：`jose`（无状态签名 cookie，故不建 sessions 表）+ `@node-rs/argon2`；UI：`antd@^6`、`@ant-design/nextjs-registry`、`dayjs`；看板：`@dnd-kit/core`+`@dnd-kit/sortable`+`@dnd-kit/utilities`。**M0 后任何 worktree 不得自行改 `package.json`/lockfile，新增依赖走集成负责人**；Playwright 例外，由 X-1 安装。
  - [x] `pnpm typecheck && pnpm lint && pnpm build` 在干净仓库全绿。

### F-3 Postgres + Drizzle 全量 schema 与首个迁移　`L`　Depends: F-1, F-2

- Files: `docker-compose.yml`（仓库根）、`.env.example`、`apps/web/src/server/db/schema.ts`、`client.ts`（单例）、`drizzle.config.ts`、`drizzle/0000_init.sql`、`src/server/db/schema.test.ts`、`src/features/notifications/service.ts`（桩，见末条）
- 按 ARCHITECTURE §6 建**全部表**（users / teams / team_memberships / team_invites / projects / tasks / subtasks / comments / notifications；不建 sessions——F-2 已定 jose 无状态 cookie），一次到位避免并行期反复迁移：
  - [x] `users.uid`、`users.username` 唯一；uid 生成器（`doing_` + 随机串，唯一且不易枚举）带单测。
  - [x] `projects`：`team_id`/`owner_id` 互斥 CHECK；`UNIQUE(team_id,slug)` 与 `UNIQUE(owner_id,slug)`（部分索引）。
  - [x] `tasks`：`project_id` 可空（不属于项目的个人任务），`assignee_id` 可空；个人空间任务 `assignee_id` 恒为本人（应用约束 + 可加触发器/校验，记录所选方案）。
  - [x] 邀请部分唯一索引 `UNIQUE(team_id, invitee_id) WHERE status='pending'`。
  - [x] **通知幂等索引（N-3 依赖）**：`UNIQUE(user_id, task_id, type) WHERE task_id IS NOT NULL`；普通索引 `notifications(user_id, read)`。
  - [x] **查询索引（D/N 依赖，M0 一次建齐）**：`tasks(assignee_id)`、`tasks(status, due_date)`、`tasks(space_type)`、`team_memberships(user_id)`、`projects(owner_id)`。
  - [x] 级联路径在 schema 外键上全部 `onDelete: 'cascade'`（删项目→任务→子任务/评论/相关通知；解散团队→全部）。
  - [x] `docker compose up -d` 起库；`db:generate/db:migrate` 脚本可用；迁移可在空库重放。
  - [x] **播种通知服务桩**：创建 `features/notifications/service.ts` 实现 §3 签名的 `createNotification(input)`——只做同事务 INSERT（调用方传入事务 client），无任何业务规则；另建 `app/api/notifications/route.ts` 返回空列表的 401 占位。N 轨道 M2 只替换内部实现，签名与文件路径不变，T/J/G 在 M1 即可真实 import 调用。

### F-4 antd v6 + 主题令牌接入　`M`　Depends: F-2（依赖由 F-2 预装；M0 内串行执行）

- Files: `apps/web/src/app/theme.ts`、`providers.tsx`（AntdRegistry + ConfigProvider `zh_CN` + dayjs locale）、`layout.tsx`（接 providers）、`globals.css`（改为只引 `tailwindcss/theme` + `utilities`，**不引 preflight/base**，删默认深色媒体查询与 Arial 样式）、`tailwind.config`/CSS 变量映射
- 验收：
  - [x] ConfigProvider token 与原型 README 的映射表逐项一致（`colorPrimary #7d2ae8`、success/warning/error/info、`borderRadius 8/12`、`controlHeight 38` 等）；品牌渐变仅用于 Logo/认证页。
  - [x] 任意一个临时演示页上 antd Button/Input/Table/Modal 无样式闪烁、无 Tailwind 重置污染；演示页提交前删除。
  - [x] `zh_CN` 与 dayjs 中文生效（DatePicker 周始于周一、中文文案）。

### F-5 应用外壳、导航桩与共享基础组件　`M`　Depends: F-4

- Files: `src/app/(dashboard)/layout.tsx`、`src/components/layout/{AppShell,Sidebar,Topbar,SpaceSwitcher,NavSection}.tsx`、占位的 `(dashboard)/page.tsx`（redirect `/my`）、`(dashboard)/my/page.tsx`（最简占位页，D-1 整体替换）、`(auth)/layout.tsx`
- **导航桩（消除 P/T 对 layout 的并发修改）**：创建空实现的 `src/features/personal/components/PersonalNav.tsx`（占位节点）与 `src/features/teams/components/TeamsNav.tsx`（占位节点）；dashboard layout **只 import 这两个固定路径**并渲染在既定位置。M0 后两文件所有权分别归 P（P-5）与 T（T-1），layout 本身任何轨道不得再改。
- **共享基础组件（M0 预置，防各轨道重复造）**放 `src/components/ui/`：`UserAvatar`（用户名首字母 + 点缀色）、`StatusTag`（未开始/进行中/已完成）、`ProgressBar`、`ConfirmModal`、`EmptyState`、`DueText`（逾期/临期/普通日期着色）。props 在本任务定稿并写组件内 JSDoc。
- 参考 `prototypes/my-tasks.html` 与 `team-overview.html` 的外壳；空间切换器渲染原型同款静态菜单（数据接线随 P/T 完成）。
- 验收：
  - [x] 桌面 1440 与 375 宽度均无横向溢出；侧栏 ≤860px 隐藏（移动端导航入口可仅占位，v1 桌面优先）。
  - [x] 顶栏预留 `<NotificationBell />` 位（import 一个渲染 null 的同名占位组件，N-2 替换实现、路径不变）与搜索框位（禁用态）。
  - [x] 上述 6 个基础组件在占位页有最小 demo 状态；未命中路由走 antd 风格 404；`(dashboard)` 与 `(auth)` 布局分离。

### F-6 认证与会话、路由守卫　`L`　Depends: F-3, F-5

- Files: `src/features/auth/{actions,service,session}.ts`、`components/`（登录/注册表单 client 组件）、`src/features/users/service.ts`（按 uid 查询）、`(auth)/login/page.tsx`、`register/page.tsx`（复刻原型两屏）、`(dashboard)/layout.tsx` 接 `requireUser`
- 决策已定（F-2 预装）：jose 签名的无状态 httpOnly cookie session（无 sessions 表）+ `@node-rs/argon2` 哈希；`SESSION_SECRET` 走 `.env.local`。把该选择补写进 ARCHITECTURE §3 决策表"理由"列。
- 验收：
  - [x] 注册只收用户名+密码（校验规则与错误文案中文，参考 register 原型），成功后生成 `doing_xxxx` 并可登录。
  - [x] 用户名重复、UID 极小概率碰撞的重试路径有测试；会话为 httpOnly 安全 cookie；登出失效。
  - [x] 未登录访问任何 `(dashboard)` 路由 → `/login`；已登录访问 `/login` → `/my`。
  - [x] 服务层测试覆盖：错误密码、不存在用户、重复注册。

**M0 出口检查（冻结点）**（以下三项由集成负责人执行，尚未完成）：

- [ ] 三人各自 clone 后按 README 能起库、跑迁移、注册登录看到空外壳。
- [ ] §3 契约评审通过并锁签名。
- [ ] 合入 main 后 **`git tag m0-frozen`**，各轨道按 §4.1 拉 worktree。

---

## 6. M1 并行波次 1

### 轨道 P：个人空间

> 目录自建 `src/features/personal/`；个人任务复用 tasks 表（`space_type='personal'`），但服务/组件不依赖 J 轨道的 teams 版实现。

#### P-1 个人项目 CRUD　`M`　Depends: F-6

- Files: `features/personal/projects/{service,actions}.ts`、`components/PersonalProjectFormModal.tsx`；路由 `(dashboard)/my/projects/[projectSlug]/page.tsx`
- 验收：
  - [x] 新建（名称必填、描述可选，弹窗文案与原型一致："仅你自己可见……同样汇总到我的任务"）、改名/描述、删除（二次确认，级联，任务一并删）。
  - [x] 权限：service 层断言 `owner_id = 当前用户`，用他人 session 调用返回权限错误（测试直调 action）。
  - [x] slug 按 `owner_id` 作用域唯一，重名生成不冲突（如 `name-2`）。
  - [ ] 个人项目不出现在任何团队查询中。（团队项目查询在 J-1/M2 落地，由 INT-2 核验）

#### P-2 个人任务 / 子任务 / 评论服务与操作　`L`　Depends: P-1

- Files: `features/personal/tasks/{service,actions}.ts`、`components/`（新建任务弹窗、子任务勾选、评论框）
- 验收：
  - [x] 任务可建在指定个人项目下或"不属于项目"；创建后 `assignee` 恒为本人；标题必填、截止日期可空、日期为 date-only。
  - [x] 子任务增删、勾选（只切 completed 与 completedAt）；**勾选不自动改主任务状态**；进度实时按 `getTaskProgress` 计算。
  - [x] 主任务状态只由手动操作改变（状态按钮/看板拖拽）。
  - [x] 评论发布/列表/本人删除（不可编辑）；个人任务评论即自我备注。
  - [x] 删除任务级联子任务/评论；全部操作有"他人不可见/不可操作"的服务层测试。

#### P-3 个人项目页（列表 + 看板）　`L`　Depends: P-2

- Files: `my/projects/[projectSlug]/page.tsx`（列表段）、同目录看板（query/seg 切换均可）、`components/ProjectTaskTable.tsx`、`PersonalKanban.tsx`
- 对照原型 `personal-project.html` / `-board.html`：
  - [x] 4 列表格（无责任人列）、状态/排序筛选、共 N 条；无子任务行展示"无子任务，按状态计 50%"；已完成行置灰删除线。
  - [x] 看板三列（未开始/进行中/已完成），HTML5/拖拽库拖卡即调 action 改状态，失败回滚并 message 提示。
  - [x] 列表/看板视图切换；新建任务弹窗项目选择仅本人项目 + "不属于项目"，无责任人字段。
  - [x] 面包屑「个人空间 / 项目名」；空项目有空状态引导。

#### P-4 个人任务详情页　`M`　Depends: P-2

- Files: `(dashboard)/my/tasks/[taskId]/page.tsx` + **共享件 `src/components/ui/task-detail/TaskDetailView.tsx`（P 创建，J-5 原样复用）**
- 共享件 props 契约（本任务定稿、J-5 只消费）：
  ```ts
  TaskDetailViewProps {
    task: TaskDetailModel;            // 任务字段 + subtasks[] + comments[]（含作者名）+ project 名
    space: 'personal' | 'team';       // personal 时隐藏责任人选择器与管理员类控件
    permissions: { canEdit: boolean; canDelete: boolean; canAssign: boolean };
    onAction: { toggleSubtask, updateStatus, updateTask, deleteTask, addComment, deleteComment } // 调各自 action
  }
  ```
- 验收：
  - [x] 全字段展示、子任务勾选联动进度条（3/5=60%）、评论流；个人态不显示责任人选择器与"管理员改动"类控件。
  - [x] 直接访问他人/不存在的任务 ID 返回 404（不泄露存在性）。

#### P-5 侧栏个人段接入　`S`　Depends: P-1

- Files: 只改 F-5 播种的桩文件 `features/personal/components/PersonalNav.tsx`（我的任务 + 个人项目列表 + 新建项目入口）；**不得改 dashboard layout**
- 验收：
  - [x] 新建项目后侧栏即时出现。
  - [x] 当前路由高亮。
  - [ ] 个人空间上下文下不渲染团队导航。（与 T-1 当前实现冲突：`TeamsNav` 按原型在个人/团队上下文都渲染「我的团队」；需 INT-1 裁决改 P-5 口径还是改 `TeamsNav`）

### 轨道 T：团队 / UID 邀请 / 角色

#### T-1 创建团队与成员关系　`S`　Depends: F-6

- Files: `features/teams/{service,actions}.ts`、`teams/new/page.tsx` 与表单
- 验收：
  - [x] 创建者自动成为 owner；slug 生成；团队名必填。
  - [x] 创建后出现在侧栏团队段（接线只改 F-5 播种的 `features/teams/components/TeamsNav.tsx`，不得改 dashboard layout）。

#### T-2 按 UID 发起邀请与撤销　`M`　Depends: T-1

- Files: `features/teams/invites/{service,actions}.ts`、团队设置页邀请区（G 轨道之前由 T 建页面骨架）、`features/users/service.ts` 的 `findByUid`
- 验收：
  - [x] UID 不存在 → 字段错误"UID 无效"；对同一人存在 pending 邀请 → 阻止（数据库部分索引兜底 + 友好错误）。
  - [x] owner/admin 可发起与撤销；member 调用 action 被拒（不只是隐藏入口）。
  - [x] 邀请无有效期；发起/撤销调用 `createNotification('team_invite')`（N 未完成前允许 no-op 桩，但调用点必须存在且类型正确）。

#### T-3 邀请接受 / 拒绝与邀请页　`M`　Depends: T-2

- Files: `(dashboard)/invites/page.tsx`、features/teams/invites actions
- 对照 `invites.html`：
  - [x] 待处理列表含团队名/邀请人/时间；接受后写 membership(member)、邀请置 accepted；拒绝置 declined；历史分区可查。
  - [x] 团队在响应前被解散/邀请被撤销时给出失效提示而非报错。
  - [x] 接受后团队出现在侧栏；通知（如已实现）标记相应已读逻辑在 N 线补，本任务留接口。

#### T-4 角色与权限判定层　`M`　Depends: T-1

- Files: `features/teams/permissions.ts`（`getMembership`、`can`/`assertCan`）、成员只读列表
- 验收：
  - [x] 覆盖设计文档 §5 矩阵每一行（含 owner 与 admin 仅治理差异：解散/转让仅 owner），表驱动测试。
  - [x] 非成员访问团队任何数据 → null/403；权限函数只抛一类可映射 403 的错误。

#### T-5 团队改名（设置页基础）　`S`　Depends: T-4

- 验收：[ ] owner/admin 可改团队名（slug 不变）；member 不可；设置页按角色显隐区块但 action 同样鉴权。

#### INT-1 集成 M1（P + T → main）　`M`　Depends: P-1..P-5, T-1..T-5

由单一集成负责人执行（不是新业务开发）：
- [x] 合入 `track/personal`（合并提交 `c5c0bb7`；`track/teams` 此前已线性进入 main）。冲突已解：`lib/slug.ts` / `slug.test.ts` 保留两条轨道的 API（`slugifyName`/`slugWithCounter` 与 `generateUniqueSlug`）并共用 `toSlugBase`；`docs/V1_TASKS.md` 轨道表合并。
- [ ] T 轨道移交的集成议题：① SpaceSwitcher 的团队列表数据接线（layout 冻结、组件静态，T 未动）；② 团队导航项当前链接到 `/teams/[teamSlug]/settings`（概览页属 D，落地后改为概览路由），已解决（D-3 TeamsNav 接线）；③ 全局 403 页无归属任务（T 仅交付 `TeamPermissionError` 契约），建议 X/INT 补页面；④ 邀请卡片的"项目数"属 J 域，J 落地后补展示；⑤ `providers.tsx`（F 所有）建议加 antd `App` 包裹，否则客户端组件里 `message.success/error` 走静态方法、无法消费动态主题（T 冒烟实测出现该警告）；⑥ `respondToInvite` 的状态更新 WHERE 未加 `status='pending'` 守卫（T 全分支评审 Minor：双击"接受"在并发窗口可能回滚为通用报错，成员关系仍成立，刷新自愈）——INT-1 前建议补 `.where(and(eq(id), eq(status,'pending')))` 并把 0 行更新映射为 `INVALID`。
- [x] 全量 `typecheck/lint/test/build` 绿（合并树：123/123 测试通过，build/typecheck 通过，lint 0 error）。
- [ ] 双人浏览器实测出口检查全流程。
- [ ] 核验 T-2/T-3 中 `createNotification` 调用点对 F-3 桩真实生效（写库可查）。
- [ ] 打 tag **`m1-frozen`**，删除两条 track worktree；N/J 从此 tag 拉新 worktree。

**M1 出口检查**：两个不同浏览器会话（两个账号）能完成：注册→互查 UID→邀请→接受→同团队可见；个人侧全流程可用。

---

## 7. M2 并行波次 2

### 轨道 J：团队项目与任务

#### [x] J-1 团队项目 CRUD　`M`　Depends: T-4

- Files: `features/projects/{service,actions}.ts`、项目新建/编辑/删除入口（项目设置放项目页内轻量入口；危险删除在 G-4 完善 UI，本任务先有权限保护的 action + 基础确认）
- 验收：
  - [x] 仅 owner/admin 可建/改/删；member 直调 action 被拒；slug 在团队内唯一。
  - [x] 删除二次确认 + 级联任务/子任务/评论/通知。
  - [x] 项目出现在团队侧栏段（`TeamsNav` 由 J 直接扩展，所有权例外已记 §4）与团队概览数据源（页面 D-1 再消费）。

#### [x] J-2 团队任务服务：创建/编辑/指派/删除　`L`　Depends: J-1（分支自 `m1-frozen`，P-4 的 TaskDetailView 与纯函数已在基线中）

- Files: `features/tasks/{service,actions}.ts`
- 验收：
  - [x] 成员均可建任务，默认指派创建者，可指派给**团队内任何人**（不能跨团队/外部 UID）；未指派允许（仅系统在成员离开时产生；UI 保留未指派展示，不提供主动清空）。
  - [x] member 只能编辑/删除**自己负责**的任务；owner/admin 可操作任意任务；编辑他人负责任务触发 `task_changed_by_admin` 通知；指派触发 `task_assigned`（指派给自己不产生通知）。
  - [x] 子任务/评论规则同 P-2；团队任务评论全员可发、本人可删。
  - [x] 每条权限分支一个服务层测试（`service.test.ts` 25 例 + `permissions.test.ts` 矩阵）。

#### [x] J-3 团队项目页：列表视图　`M`　Depends: J-2

- 对照 `project-list.html`：状态/责任人/截止日期筛选排序、分页、9+ 行密度、进度内联（子任务比例 + 无子任务状态映射文案）、新建任务弹窗（项目选择含个人空间三项 + 本团队项目，与我的任务页同口径）、已完成置灰。
- 落地与原型差异（控制器裁决）：新建任务弹窗只列**本团队项目**（团队页面上建个人任务会把入口与权限混在一起）；不做「按责任人」排序（只做筛选）。

#### [x] J-4 团队项目页：看板拖拽　`M`　Depends: J-2

- 对照 `project-board.html`：选定拖拽库（记录选型理由）；三列拖放即改状态、乐观更新失败回滚；移动端降级为可用（按钮或单列，不要求拖拽）。
- 选型：`@dnd-kit/core`（`PointerSensor` 6px 激活距离 + `KeyboardSensor`），不依赖 HTML5 DnD，键盘可达。冒烟时用鼠标指针序列验证拖放（Playwright `dragTo` 走 HTML5 事件，不触发 dnd-kit，不要用它判断回归）。

#### [x] J-5 团队任务详情页　`M`　Depends: J-2

- Files: `teams/[teamSlug]/projects/[projectSlug]/tasks/[taskId]/page.tsx`
- 对照 `task-detail.html`：编辑控件按角色/责任人显隐且 action 端再校验；跨空间 URL 不可互访（个人任务 URL 用团队路径访问返回 404）。
- 冒烟修正：只读态（member 打开他人任务）原先仍显示「更改」「标记为已完成」与子任务勾选/增删入口，已在共享件 `TaskDetailView` 按 `permissions.canEdit` 统一门禁（`TaskDetailView.test.ts` 回归）。

### 轨道 N：通知与 cron

#### N-1 通知服务定稿 + 接线清单　`M`　Depends: F-3

- Files: `features/notifications/service.ts`（替换 F-3 桩的内部实现，**签名不变**）、`docs/notifications-wiring.md`（接线清单）
- 边界（保护文件所有权）：N **不改** T/J/G 的 action 文件；接线动作由各轨道在自己的任务里完成（T-2/T-3、J-2、G-1/G-3 的验收已包含 `createNotification` 调用点）。
- 验收：
  - [x] 服务支持调用方传入事务 client，通知与业务写操作在**同一事务**内提交/回滚；类型覆盖 6 种（`team_invite/task_assigned/task_due_soon/task_overdue/task_commented/task_changed_by_admin`）；通知含类型、接收人、关联对象、触发者、已读、时间。
  - [x] 接线清单（`docs/notifications-wiring.md`）逐行列出：在哪个 action、什么条件、通知谁、关联对象怎么取（含"邀请接受不通知自己""评论不通知本人""个人空间只产生到期类提醒"）；每个接线点在 INT-2 由集成负责人核验存在且参数正确。
  - [x] 提供 N-2 需要的查询函数（未读数、分页列表、标记已读，见 `features/notifications/queries.ts`）。

#### N-2 通知中心 UI 与未读角标　`M`　Depends: N-1, F-5

- Files: `features/notifications/components/NotificationBell.tsx`、轮询 Route Handler（`/api/notifications` 是通知中心自身需要，属 §2 API 例外，在板上记录）、列表/标记已读
- 对照原型顶栏 popover：
  - [x] 未读角标轮询刷新；点击单条标记已读并跳转关联任务；全部已读；空态文案。
  - [x] 个人任务到期提醒能出现（见 N-3）；个人项目不产生指派/评论/改动类通知。

#### N-3 到期扫描 cron　`M`　Depends: N-1

- Files: `app/api/cron/due-scan/route.ts`、`features/notifications/due-scan.ts`
- 验收：
  - [x] `CRON_SECRET`（Bearer 或自定义头）校验，错误密钥 401。
  - [x] 扫描**全部空间**（含个人）未完成任务：按 Asia/Shanghai 当天判定临期（今天/明天）与逾期（今天 > due_date）。
  - [x] 幂等：`(user_id, task_id, type)` 去重约束或等价检查，重复扫描不产生重复通知；任务转 done 后不再产生新通知（历史保留）。
  - [x] 有可本地运行的触发命令写入 `.env.example` 注释/ README。

#### INT-2 集成 M2（J + N → main）　`M`　Depends: J-1..J-5, N-1..N-3

- [x] 从 `m1-frozen` 合入 J、N 两条 track；核验 N-1 接线清单每个调用点存在、参数正确、个人空间无指派/评论类通知。（单人开发：J/N 均在 `asher/m33` 分支完成，2026-10-24 fast-forward 合入 main；接线清单 5 个调用点核验一致——`createInvite`/`respondToInvite`、`tasks/service.ts` 262/392/409/578 行；`features/personal/**` 0 处 `createNotification`）
- [x] 全量检查绿；cron 在共享测试库手跑两次，验证幂等（同任务同类型仅一条）。（255/255 测试、typecheck/lint/build 绿；`due-scan.test.ts` 连跑两次幂等用例 + N-6 冒烟实测 dev 库两次 cron `200 {dueSoon:1,overdue:1}` → `200 {dueSoon:0,overdue:0}`）
- [x] 合入 main，打 tag **`m2-frozen`**，删 track worktree；D/G 从此 tag 拉。（单人开发无独立 track worktree；`od-personal` 为 M1 遗留、另有 INT-1 未勾项，保留待 INT 清理）
- [x] J 轨道移交的集成议题：① N-1 接线清单覆盖 J-2 三类通知，已核验（`docs/notifications-wiring.md`）；② **集成裁决：`notifySafely` 保留不移除**——同类型重复通知仍会发生（任务改派回原责任人 → 第二条 `task_assigned` 撞 `(user_id, task_id, type)` 唯一索引），其 savepoint 捕获正是事务内 `onConflictDoNothing` 的等价物，移除会使改派回环报错；③ 团队侧栏 `TeamsNav` 由 J-1 直接扩展（所有权例外，§4），已落；④ 新 worktree 跑 typecheck 前先 `pnpm exec next typegen`（`PageProps` 全局类型由 Next 生成）；⑤ `pnpm --filter @open-doing/web build` 需显式 `DATABASE_URL`（`db/client.ts` 生产态抛错）；⑥ 浏览器冒烟遗留物：`message` 静态调用警告为全仓既有模式（T 已记 INT-1 议题 ⑤：`providers.tsx` 加 antd `App` 包裹）。

**M2 出口检查**：团队项目协作全流程（建项→派活→评论→拖看板→收到通知）；cron 手动触发产生且只产生一条提醒。

---

## 8. M3 并行波次 3

### 轨道 D：聚合仪表盘

#### D-1 我的任务页（跨空间聚合）　`L`　Depends: P-2, J-2

- Files: `(dashboard)/my/page.tsx`（所有权归 D，P 提供个人数据访问函数）、统计卡组件
- 对照 `my-tasks.html`：
  - [x] 个人任务段含**个人项目内任务**（带项目 chip，无项目显示"不属于项目"口径）；团队任务段跨所有团队按 assignee=本人聚合；默认按截止日期升序（无日期排后）。
  - [x] 顶部统计（进行中/今日明日到期/已逾期/本周已完成）口径与纯函数一致；"新建任务"弹窗项目选择跨空间全列。
  - [x] 聚合在 SQL 侧完成（计数/平均），不全表拉内存；空段有空状态。

#### D-2 团队概览：项目健康度 + 风险区　`L`　Depends: J-1, J-2

- Files: `teams/[teamSlug]/page.tsx`
- 对照 `team-overview.html`：
  - [x] 各项目进度条（任务等权平均，空项目 0%），按项目下未完成任务的逾期/临期存在性标色（阈值记录常量，可调）。
  - [x] 风险区：逾期任务、临期任务排最前，点击进任务详情。
  - [x] 只读：任何成员可访问，页面无任何写操作按钮（主管无催办/改派）。

#### D-3 成员负载与未指派区　`M`　Depends: D-2

- 验收：
  - [x] 每成员：进行中任务数、即将到期数；可下钻看该成员各项目任务。
  - [x] 未指派任务单独成区（为离开成员置空的数据场景），提示 admin 重新指派（链接到任务详情，不在概览页直接改）。

### 轨道 G：团队治理与生命周期

#### G-1 移除成员　`M`　Depends: T-4

- 验收：
  - [x] owner/admin 可移除；被移除人其负责任务**保留并置 assignee=null**，membership 删除；其不再能看到团队任何数据（可见性过滤测试）。
  - [x] 移除 owner 被阻止（须先转让）。

#### G-2 主动退出 / owner 限制　`S`　Depends: G-1

- 验收：[x] 普通退出同移除语义；owner 退出被拒并提示先转让或解散（设置页文案对齐原型危险区）。

#### G-3 转让团队 / 解散团队　`M`　Depends: G-1

- 对照 `team-settings.html` 与二次确认弹窗：
  - [x] 仅 owner；转让后角色互换、唯一性保持；解散为硬删除级联（项目/任务/成员关系/邀请/通知），输入确认或按钮二次确认。
  - [x] 解散后双方侧栏与所有旧 URL 行为正确（404/回首页）。

#### G-4 设置页整合（成员/邀请/危险区）　`M`　Depends: T-2, T-5, G-1..G-3

- 验收：[x] 一个页面对照原型分区呈现；角色不足时区块隐藏且直接 action 调用全部 403；邀请的发出/撤销在此也可操作（T-2 能力复用）。

#### INT-3 集成 M3（D + G → main）　`M`　Depends: D-1..D-3, G-1..G-4

- [x] 从 `m2-frozen` 合入 D、G；重点核验 `my/page.tsx`（D 整体替换 F-5 占位）与团队设置页（G 整合 T-2/T-5 区块）的衔接。（D 已随 e460ea9 合入 main；G 与本提交一同合入 main）
- [x] 全量检查绿；按角色矩阵跑一遍手工冒烟（owner/admin/member/非成员/本人之外的个人空间访问）。（297/297 测试、typecheck/lint/build 绿；G 手工冒烟覆盖 owner/admin/member，非成员/他人个人空间由服务层测试覆盖）
- [x] 合入 main，打 tag **`m3-frozen`**，删 track worktree，X 轨道开始。（tag `m3-frozen` 打在本提交）

**M3 出口检查**：设计文档 §1–§10 每条功能都能在运行中的应用里演示；权限矩阵全部分支有自动化测试。

---

## 9. M4 收尾（轨道 X）

- [x] **X-1 端到端走查**（`M`）：按原型 11 个页面逐屏比对（含个人项目两页）；补 Playwright 关键流：注册→建个人项目→建任务打勾；邀请接受；看板拖卡；cron 提醒；解散团队。（`docs/x-audit-walkthrough.md`：11/11 页对照，必修 F-1..F-3 已修；e2e 5 条流 + 16 条响应式 = 21/21 绿）
- [x] **X-2 状态完整性**（`M`）：所有列表/按钮的 loading、空状态、失败 message、乐观更新回滚；403/404 页面；表单校验错误中文展示。（`docs/x-audit-walkthrough.md` §5：loading/空态/失败提示/中文校验/乐观回滚逐项核对；权限拒绝在页面层统一为 404 防存在性泄露，action 层返回中文 403 文案，无独立 403 页）
- [x] **X-3 响应式与可达性**（`S`）：375px 全站零横向溢出；键盘可操作（弹窗 Esc/焦点陷阱）、antd 语义与标签齐全、`prefers-reduced-motion` 降级。（`docs/x-audit-a11y.md`：16 条 375px 零溢出用例；R-1 与 A-1..A-4 已修，选修 S-1..S-4 已登记）
- [x] **X-4 seed 与本地开发说明**（`S`）：种子脚本复刻原型示例数据（林夏 doing_x7k2m9 等 5 人、增长突击队、3 团队项目 + 2 个人项目、基准日 2026-10-21 的任务日期相对今天生成）；README 写清 compose/migrate/seed/dev/cron 触发。（seed `0c7ed73` + 角色对齐 `bacb8ef`；README Quickstart/迁移/seed/cron 段落）
- [x] **X-5 安全走查**（`S`）：逐服务函数核对权限矩阵；cookie 属性、argon2 参数、cron 密钥、UID 不可枚举性、SQL 注入（Drizzle 参数化）与 XSS（不使用 `dangerouslySetInnerHTML`）。（`docs/x-audit-security.md`：必修修复 0；矩阵判定层 0 未测分支；8 处 service 接线缺口评估为无需改代码）
- [x] **X-6 v1 范围复核**（`S`）：对照设计文档"非目标"确认无越界功能（无邮箱/邮件、无密码找回、无实时推送、无文件上传——头像用用户名首字母）。（`docs/x-audit-scope.md`：四项 + §1 七条非目标逐条 grep，无越界）

## 10. 完成定义（v1 Done）

1. [ ] M1–M4 全部勾选，`pnpm -r typecheck && lint && test && build` 全绿。
   - 命令链实跑（2026-10-25，文档改动前 HEAD `b1050f4`）：`DATABASE_URL=… pnpm build` 成功
     （Next 16.4.2，16 条路由）；`pnpm -r typecheck` 两包 Done；`pnpm -r lint` 0 error
     （1 个既有 warning `apps/web/src/features/teams/invites/service.ts:224`）；
     `TEST_DATABASE_URL=…/open_doing_test pnpm test` → 33 文件 / 297 测试全部通过（20.98s）。
   - **「M1–M4 全部勾选」未满足**：X 轨道本次收尾后 X-1..X-6 已勾选，但 M1 段仍保留历史未勾选项——
     `:238-240`（M0 出口检查）、`:257`（P-1）、`:300`（P-5 团队导航口径待裁决）、`:336`（T-5）、
     `:342`/`:344`/`:345`/`:346`（INT-1 集成议题、双人浏览器实测、通知调用点核验、`m1-frozen` tag）。
     其中 `:344` 的双人浏览器出口实测从未单独执行（后由 e2e 21 条覆盖）；其余多为后续任务已解决
     但未回填的簿记项（如 `:346` 的 tag 已在 INT-2 记录中引用）。按板面事实本条留空，
     待集成负责人在收尾流程清理 M1 记录。
2. [x] 设计文档 §5 角色矩阵每个分支至少一条自动化测试；级联删除路径有集成测试。
   - 矩阵判定层 0 未测分支：`features/teams/permissions.test.ts:11-46`（8 动作 × 3 角色 + null 全表）、
     `features/tasks/permissions.test.ts:20-58`（任务动作 × 角色 × 本人/他人/未指派）（`docs/x-audit-security.md` §10、§12）。
   - service 接线层 8 处 owner/admin 成功分支缺集成断言（security §10.1：`renameTeam` admin、
     `rescindInvite` admin、`removeMember` owner、`leaveTeam` admin、`updateTeamTask` admin、
     `deleteTeamTask` 全矩阵、`updateTeamProject` admin、`deleteTeamProject` admin）；
     逐行核对无参数错位，评估结论为「无需改代码，补测列为选修」。
   - 级联删除集成测试：解散团队七类关联行（`features/teams/members/service.test.ts:458`）、
     团队项目删除（`features/projects/service.test.ts:199`）、个人项目删除
     （`features/personal/projects/service.test.ts:153`）、个人任务删除（`features/personal/tasks/service.test.ts:355`）。
   - 状态与可达性佐证见 `docs/x-audit-walkthrough.md`、`docs/x-audit-a11y.md`。
3. [x] 原型 11 页全部有对应真实页面，视觉与令牌一致，无原型占位文案残留。
   - `docs/x-audit-walkthrough.md` §2 的 11 行对照表：11/11 有真实路由；3 项必修偏差已修
     （F-1/F-2/F-3，commit `2ceb563`），13 项选修偏差登记（O-1..O-13，其中 O-2/O-11 为规格允许的 N-A），
     数据差异 1 项（O-15，seed 计数差异）。
   - 视觉一致性由 `docs/x-audit-a11y.md` 的 375px/语义取证与令牌化颜色、过渡规则佐证；
     源码无用户可见的原型演示 callout 或占位文案（`占位|原型` 命中仅为实现注释）。
4. [x] 另一台机器按 README 可在 15 分钟内跑起本地环境并走通 X-1 的全部关键流。
   - 依任务约定未实际准备第二台机器，本条为 README 书面评估 + 本机命令复核。
   - README 覆盖两条路径：方式 A `docker compose up --build` 一键（compose→迁移→dev，`README.md:40-53`）；
     方式 B `compose→env→migrate→seed→dev`（`:55-149`），cron 触发与 crontab（`:197-216`）。
     X-1 五条关键流均可由此走通；步骤与仓库实际脚本一致（`db:migrate` / `db:seed` /
     `api/cron/due-scan` 均存在且前序任务已实跑）。
   - 风险（不影响判定）：方式 A 首次构建镜像 + 安装依赖耗时依赖网络，慢网络下 15 分钟可能超时；
     方式 A 手动触发 cron 需知道 compose 默认 `CRON_SECRET=dev-only-change-me` 或先在根 `.env` 设置
     （`README.md:51` 有说明，cron 段落未给方式 A 示例）；方式 A 不自动 seed（X-1 关键流不依赖 seed）。
