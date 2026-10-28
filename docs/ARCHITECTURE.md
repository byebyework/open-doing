# Open Doing 架构说明

日期：2026-10-21
配套文档：[2026-10-21-open-doing-v1-design.md](./2026-10-21-open-doing-v1-design.md)

本文描述 v1 的目标架构。功能"是什么、为什么"以设计文档为准，本文只讲"怎么搭"。

## 1. 总览

单体 Web 应用（v1 不拆微服务）：

- **Next.js 16（App Router，React 19，Turbopack）** 同时承载页面、Server Actions、Route Handler。
- **PostgreSQL** 作为唯一持久化存储，**Drizzle ORM** 负责 schema、迁移与查询。
- 定时扫描（临期/逾期通知）通过受保护的 Route Handler + 外部 cron 触发，v1 不引入独立 worker。
- 不发邮件、不接第三方服务；除数据库和 cron 外无外部依赖。

```
浏览器
  │  HTTP（RSC 页面 / Server Action / Route Handler）
  ▼
apps/web（Next.js）
  ├── app/            路由层：页面、actions、api
  ├── features/*/     领域模块：业务逻辑与数据访问
  └── server/         基础设施：db、auth、会话
  │
  ▼
PostgreSQL（本地开发用 Docker）
```

## 2. Monorepo 布局

pnpm workspaces：

```
apps/
└── web/                 # @open-doing/web，Next.js 应用
    └── src/
        ├── app/         # 路由（见第 5 节）
        ├── features/    # 领域模块（见第 4 节）
        ├── components/  # ui/ 通用组件、layout/ 框架布局
        ├── hooks/       # 通用客户端 hooks
        ├── lib/         # 纯工具函数
        └── server/      # db 客户端、auth/session、定时任务入口
packages/
└── types/               # @open-doing/types，前后端共享的领域类型与纯计算
```

- `@open-doing/types` 只放**可序列化的类型和纯函数**（如进度计算），不依赖 React、不访问数据库、不做 IO。
- 数据库行类型（Drizzle infer）留在 web 包内；需要跨边界传递时在 features 层映射为 `@open-doing/types` 的领域模型。
- web 通过 `workspace:*` 引用内部包；`next.config.ts` 中 `transpilePackages` 已包含 `@open-doing/types`。
- 未来如抽出 UI 组件库或独立 API 客户端，按 `packages/ui`、`packages/api-client` 同样方式扩展。

## 3. 技术决策

| 方面 | 选择 | 理由 |
|---|---|---|
| 框架 | Next.js 16 App Router | 单应用承载页面 + 服务端逻辑；RSC 减少数据获取样板 |
| 语言 | TypeScript（strict） | 共享类型贯穿前后端 |
| UI 组件库 | **Ant Design v6** | 中后台场景组件齐全（表格、表单、看板可基于其拖拽能力扩展） |
| SSR 样式 | `@ant-design/nextjs-registry` | App Router 下收集 cssinjs 样式，避免首屏闪烁 |
| 样式工具 | **Tailwind CSS 4（关闭 preflight）** | 负责布局/间距/微调；关闭样式重置避免与 antd 冲突 |
| 主题/语言 | ConfigProvider：`zh_CN` 语言包 + dayjs 中文 locale，亮色主题 | 统一中文化；品牌色通过 Design Token / CSS Variables 定制 |
| 数据库 | PostgreSQL | 关系完整性、级联删除、唯一约束（用户名、UID） |
| ORM | Drizzle | 轻量、SQL 贴近、类型推断好，迁移工具内置 |
| 本地数据库 | Docker compose | 环境一致，零手工安装 |
| 认证 | 用户名 + 密码；jose HS256 **无状态签名** httpOnly cookie（`od_session`，sameSite lax，30 天，payload `{ userId }`）+ `@node-rs/argon2`（Argon2id） | 不建 sessions 表：免查库校验、免会话清理任务；Argon2id 抗 GPU 破解且原生实现性能好；签名密钥来自 `SESSION_SECRET` |
| 数据变更 | Server Actions 为主 | 与 App Router 表单/渐进增强契合 |
| 定时任务 | 受保护 Route Handler + cron | 不引入 worker，部署简单 |
| 包管理 | pnpm workspaces | 已定 |

## 4. 领域划分

业务代码按领域组织，每个领域自包含 components / actions / 数据访问：

```
features/
├── auth/       注册、登录、登出、会话
├── users/      用户资料、按 UID 查询（邀请时用）
├── teams/      团队、成员关系、邀请、角色与权限判定
├── projects/   项目 CRUD
├── tasks/      任务、子任务、评论、看板状态流转
└── notifications/ 通知、已读、到期扫描
```

- **actions/**：Server Action，只做入参校验、权限校验、调用领域逻辑、返回 `ActionResult`（成功或带字段错误的失败对象）。
- **components/**：该领域专用组件；跨领域复用的基础组件放 `components/ui`。
- 数据访问函数与业务规则（如"member 不能改他人任务"）集中在各 feature 的服务端模块中，不散落在页面里。页面（RSC）负责取数与组装，客户端组件只负责交互。

### 4.1 UI 层约定（antd v6 + Tailwind 4）

- **组件以 antd 为准**：表单、表格、弹窗、菜单、日期选择等直接用 antd，不自己造；`components/ui/` 只放基于 antd 的二次封装与项目通用组合组件。
- **Tailwind 负责布局与微调**：页面骨架、间距、flex/grid 用 Tailwind 原子类；**关闭 preflight**（在 `globals.css` 中只引入 `tailwindcss/theme` 与 `tailwindcss/utilities`，跳过 base reset），避免按钮/标题等重置样式与 antd 互相污染。
- **客户端边界**：antd 的交互组件（useMessage、Modal、Table 交互等）只能在 Client Component 中使用。页面保持 RSC 取数，把 antd 交互部分下沉为 `"use client"` 组件，通过 props 传可序列化数据。
- **根布局**：用 `AntdRegistry` 包裹应用做 SSR 样式收集；`ConfigProvider` 注入 `zh_CN`（同步设置 dayjs 中文 locale），主题统一在一个 `theme.ts` 中配置 Token（v1 亮色，品牌色后续在此一处调整）。
- 样式冲突排查原则：优先用 antd Token 和组件属性，Tailwind 不覆盖 antd 组件内部样式；确需深度定制时用 antd 的 token/className 钩子，不用全局选择器硬改。
- 看板拖拽的卡片基于 antd 基础元素实现，拖拽库实现阶段选型。

## 5. 路由结构

v1.1 起统一为空间树：`/space/{spaceRef}/{module}`，`spaceRef` 取 `personal` 或团队 slug，`module` ∈ `dashboard / kanban / calendar / analysis / settings`。

```
app/
├── (auth)/
│   ├── login/page.tsx
│   └── register/page.tsx
├── (dashboard)/                     # 登录后布局：侧边栏 + 顶栏（含通知角标）
│   ├── page.tsx                     # `/` → /space/personal/dashboard
│   ├── invites/page.tsx             # 待处理邀请（接受/拒绝），非空间页
│   ├── teams/
│   │   ├── new/page.tsx             # 创建团队，非空间静态页
│   │   └── join/page.tsx            # 凭码加入，非空间静态页
│   └── space/
│       ├── personal/
│       │   ├── dashboard/page.tsx   # 个人 Dashboard：统计卡 +「今天」列表（≤20）
│       │   ├── projects/[projectSlug]/
│       │   │   └── page.tsx         # 个人项目页（列表/看板双视图，仅本人）
│       │   └── tasks/[taskId]/page.tsx # 个人任务详情（含个人项目内任务）
│       ├── [teamSlug]/
│       │   ├── dashboard/page.tsx   # 团队 Dashboard：健康度 + 重要节点 + 成员负载
│       │   ├── settings/page.tsx    # 团队设置（静态段优先于 [module] 占位页）
│       │   ├── projects/
│       │   │   ├── new/page.tsx
│       │   │   └── [projectSlug]/
│       │   │       ├── page.tsx      # 团队项目页（列表/看板双视图）
│       │   │       └── tasks/[taskId]/ # 团队任务详情
│       │   └── [module]/page.tsx    # 模块占位页（kanban/calendar/analysis/settings）
└── api/
    └── cron/
        └── due-scan/route.ts        # 临期/逾期扫描，受密钥保护
```

- 个人空间的 `kanban / calendar / analysis / settings` 由团队空间的 `space/[teamSlug]/[module]/page.tsx` 同一文件承接（URL 中该段实际取值为 `personal`）。
- 动态段名约束：Next 要求同一位置的动态段名唯一，团队空间已占用 `[teamSlug]`，因此占位页沿用该段名，URL 语义仍是 `spaceRef`（`personal` 或团队 slug）。
- `personal` 为保留 spaceRef：团队 slug 生成需避开 `personal`（当前无 guard，排期 X1）。
- 路由参数一律使用 slug（团队/项目）；任务详情用不透明内部 ID。
- 个人任务与团队任务复用同一任务详情组件，差异通过 `spaceType` 与权限上下文处理。
- 所有 `(dashboard)` 路由在服务端统一做登录校验（重定向到 `/login`）；权限不足返回 403 页面，而不是仅靠隐藏按钮。

### 5.1 旧 URL 重定向（`apps/web/next.config.ts`，全部 307 temporary）

| 旧路径 | 新路径 | 说明 |
|---|---|---|
| `/my` | `/space/personal/dashboard` | 原「我的任务」页 |
| `/my/:path*` | `/space/personal/:path*` | 个人项目页 / 任务详情等深链 |
| `/teams/:slug` | `/space/:slug/dashboard` | 原团队概览页 |
| `/teams/:slug/:path*` | `/space/:slug/:path*` | 团队设置 / 项目页 / 任务详情等深链 |

- 团队 slug 参数使用完整段模式 `((?!(?:new|join)(?:/|$))[^/]+)` 排除静态页：Next 16.4.2 的 path-to-regexp 不接受 `(?!new|join)` 直接作参数模式。
- `/teams/new`、`/teams/join`、`/invites` 不是空间路由，保持自己的静态页面，不参与重定向。

### 5.2 F-5 契约变更（2026-10-28）

v1.1 统一导航替换原 PersonalNav / TeamsNav 双槽：

- `AppShell` props 变为 `{ nav, mobileNav, user, children }`；
- 新增 `SpaceNav`、`SpaceNavData`（`getSpaceNavData()` 一次取齐）、`SpaceNavMenu`（Dashboard / Kanban / Calendar / Analysis / 设置 + 账号分组）、`MobileNav`（<861px 汉堡按钮 `aria-label="打开导航"` + antd Drawer）；
- 桌面侧栏与移动 Drawer 共用同一棵导航树，`(dashboard)/layout.tsx` 的导入关系相应调整。

## 6. 数据模型

核心表（字段为概要，最终以 Drizzle schema 与迁移为准）：

```
users
  id            内部主键（不暴露）
  uid           对外标识，唯一，doing_xxxx（邀请用）
  username      登录名/显示名，唯一
  password_hash
  created_at

teams
  id, name, slug（团队内/全局唯一策略实现时定）, owner_id -> users.id, created_at

team_memberships
  id, team_id -> teams.id, user_id -> users.id
  role          owner | admin | member
  joined_at
  UNIQUE(team_id, user_id)

team_invites
  id, team_id -> teams.id, invitee_id -> users.id, invited_by_id -> users.id
  status        pending | accepted | declined | rescinded
  created_at, responded_at
  UNIQUE(team_id, invitee_id) WHERE status = 'pending'   -- 部分唯一索引

projects
  id, name, slug, description, created_at
  team_id -> teams.id (nullable：个人项目)
  owner_id -> users.id (个人项目归属人；团队项目为空)
  CHECK((team_id IS NOT NULL) <> (owner_id IS NOT NULL))  -- 二选一
  -- slug 唯一范围：团队项目 UNIQUE(team_id, slug)；个人项目 UNIQUE(owner_id, slug)

tasks
  id, project_id -> projects.id (nullable：不属于任何项目的个人任务)
  space_type     personal | team
  title, description
  status         todo | in_progress | done
  assignee_id -> users.id (nullable：成员退出/被移除后未指派)
  due_date       date（仅日期，Asia/Shanghai 语义）
  created_by_id -> users.id
  created_at, updated_at

subtasks
  id, task_id -> tasks.id (级联删除), title, completed, created_at, completed_at

comments
  id, task_id -> tasks.id (级联删除), author_id -> users.id, content, created_at

notifications
  id, user_id -> users.id, type, read
  team_id / project_id / task_id（按类型取用，可为空）
  actor_id -> users.id（系统产生的通知为空）
  created_at

sessions（v1 不建：使用 jose 无状态签名 cookie，见 §3）
```

关键约束与行为：

- `users.uid`、`users.username` 各建唯一索引；UID 随机生成、不可枚举。
- 个人空间数据：`space_type = 'personal'` 的任务（`project_id` 可指向本人的个人项目，也可为空），以及 `owner_id = 本人` 的个人项目，只能由本人访问（见第 7 节）；个人项目的任务 `assignee_id` 恒为本人。
- **级联删除**：删项目（团队项目或个人项目）→ 其下任务/子任务/评论及相关通知；解散团队 → 项目、成员关系、邀请、通知。用数据库外键 `ON DELETE CASCADE` 兜底，应用层二次确认。
- 移除成员/退出：只删 `team_memberships`，**不删任务**，将其 `assignee_id` 置空。
- 邀请用部分唯一索引防止对同一人生成多个 pending 邀请。

## 7. 权限模型（执行点）

角色矩阵见设计文档第 5 节。架构上的执行原则：

1. **每个 Server Action 独立鉴权**，不信任页面是否隐藏了入口。统一在 `features/teams` 提供：
   - `getMembership(teamId, userId)` → 角色或 null；
   - `can(action, actor, resource)` 形式的判定（如 `canEditTask`：责任人本人或团队 owner/admin）。
2. 数据查询带**可见性过滤**：团队任务只在"我是该团队成员"时可见；个人空间数据（个人任务、个人项目）只有本人可见。
3. 评论权限与任务内容编辑权限分开：成员可评论，但不能改他人任务内容。
4. 团队管理动作（建项目、邀请、移除成员、删项目、解散、转让）在 service 层再次校验 owner/admin；个人项目的创建/编辑/删除只校验 `owner_id = 当前用户`，与团队角色体系完全独立。

## 8. 进度聚合与截止日期

纯计算逻辑放在 `@open-doing/types`，服务端只负责取数：

- 任务进度：有子任务 → 完成子任务 / 子任务总数；无子任务 → 状态映射 0 / 0.5 / 1。
- 项目进度：项目下全部任务进度的等权平均，空项目 0（团队项目与个人项目同口径）；团队进度：各团队项目进度等权平均，无项目 0，个人项目不参与。
- 概览仪表盘的聚合在数据库侧完成（SQL 聚合任务/子任务计数），应用层套用同一套口径，避免把整表拉进内存。
- `due_date` 使用 Postgres `date` 类型。逾期判定：`当前日期(Asia/Shanghai) > due_date 且 status != done`；临期：`due_date IN (今天, 明天) 且未完成`。会话与数据库连接统一使用东八区口径计算。

## 9. 通知

- 通知由领域动作**同步产生**（邀请、指派、评论、管理员改动），与业务修改在同一事务内写入，避免丢失。
- 临期/逾期由 `GET/POST /api/cron/due-scan` 扫描产生（扫描范围含个人空间任务——对本人的自我提醒；个人项目不产生指派、评论、改动类通知）：
  - 用环境变量中的 cron 密钥（如 `Authorization: Bearer` 或自定义头）校验；
  - 幂等：同一任务同一类型在到期窗口内只产生一条（按 `(user_id, task_id, type)` 加去重约束或写入前检查）；
  - 扫描后任务转已完成不再产生新通知（已产生的历史通知保留）。
- 前端在 `(dashboard)` 布局中拉取未读数显示角标（轮询即可），通知中心支持列表与标记已读。

## 10. 服务端渲染与数据获取约定

- 页面默认 RSC：直接在服务端按当前会话用户取数，不经过公开 API。
- 写操作统一走 Server Action；Route Handler 只用于 cron（v1 不暴露公开 REST API）。
- 客户端组件限定为：看板拖拽、表单交互、通知轮询、视图切换。
- 数据库连接放在 `server/db.ts`，单例，避免开发热重载产生多连接。

## 11. 配置与环境

`apps/web` 需要的环境变量（`.env.local`，不入库）：

```
DATABASE_URL=postgres://open-doing:open-doing@localhost:5433/open-doing
SESSION_SECRET=...
CRON_SECRET=...
```

- 仓库根目录提供 `docker-compose.yml`（实现阶段添加）启动本地 PostgreSQL。
- Drizzle 配置与迁移文件放在 web 包内（如 `src/server/db/` + `drizzle/`），`pnpm --filter @open-doing/web db:generate / db:migrate`。

## 12. 当前状态 vs 目标

| 部分 | 现状 |
|---|---|
| Monorepo、Next.js 16、Tailwind 4（preflight 已关闭）、ESLint | ✅ 已完成 |
| antd v6 接入（registry、ConfigProvider zh_CN、亮色主题） | ✅ 已完成 |
| `@open-doing/types` 共享类型与纯函数 | ✅ uid/username、邀请、通知、`getTaskProgress`、`isOverdue` 等已落地 |
| PostgreSQL / Drizzle / 迁移 / 种子 | ✅ 已完成（迁移可在空库重放） |
| 认证与会话（注册 / 登录 / `requireUser()` 守卫） | ✅ 已完成 |
| 团队/项目/任务/通知业务代码、团队设置、邀请与凭码加入 | ✅ 已完成 |
| 路由：统一空间树 `/space/{spaceRef}/{module}` + 旧 URL 307 重定向 | ✅ v1.1 M2（`next.config.ts`，见 §5.1） |
| 导航：SpaceSwitcher + 五模块 SpaceNavMenu + 移动端 Drawer（<861px） | ✅ v1.1 M2（F-5 契约变更，见 §5.2） |
| 个人 Dashboard `/space/personal/dashboard` | ✅ v1.1 M2：四张统计卡 +「今天」列表（≤20，逾期置顶，行内勾选） |
| 团队 Dashboard `/space/[teamSlug]/dashboard` | ✅ v1.1 M2：四张统计卡 + 项目健康度 + 重要节点（前 10）+ 成员负载 |
| 个人/团队项目页（列表 + 看板双视图）与任务详情 | ✅ 已迁入 `/space/{spaceRef}/projects/...`、`/space/personal/tasks/{id}` |
| 空间级 Kanban / Calendar / Analysis / 个人设置 | 🟡 占位页 `/space/{spaceRef}/{module}`，待 M3–M6 |
| cron 到期扫描（`CRON_SECRET` 鉴权、幂等） | ✅ 已完成 |

## 13. 建议的实施顺序（概要）

1. 基础设施：Docker Postgres、Drizzle 接入、schema 与首个迁移、修订共享类型。
2. UI 基座：接入 antd v6（AntdRegistry、ConfigProvider zh_CN、亮色主题）、关闭 Tailwind preflight、搭建应用整体布局。
3. 认证：注册/登录/会话、路由守卫。
4. 个人空间：个人项目 CRUD、任务/子任务/评论的增删改查（含不属于项目的个人任务）、我的任务页、个人项目页、任务详情。
5. 团队与项目：创建团队、按 UID 邀请/接受、成员与权限、团队项目 CRUD。
6. 团队任务：指派、项目列表/看板、权限边界。
7. 团队概览聚合页、未指派任务区。
8. 通知中心与 cron 到期扫描。
9. 团队设置：移除成员、退出、删除项目、解散/转让。

详细计划在设计文档确认后另行编写。
