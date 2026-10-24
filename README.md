# Open Doing

项目任务进度管理系统。解决三个问题：个人任务理不清、团队进度不同步、上级看不到工作情况。

## Monorepo 结构

使用 pnpm workspaces 管理：

```
apps/
└── web/                    # Next.js 应用（App Router）
    ├── drizzle/            # Drizzle 迁移文件
    └── src/
        ├── app/            # 路由
        │   ├── (auth)/     # 登录、注册
        │   ├── (dashboard)/
        │   │   ├── my/     # 个人空间：我的任务
        │   │   └── teams/  # 团队 → 项目 → 任务
        │   └── api/
        ├── features/       # 按领域组织：auth / teams / projects / tasks / notifications
        ├── components/     # ui、layout
        ├── hooks/
        ├── lib/
        └── server/         # 数据库连接与 schema

packages/
└── types/                  # @open-doing/types 共享领域模型与纯函数
```

## 技术栈

- Next.js 16（App Router，Turbopack）+ React 19 + TypeScript
- antd v6（ConfigProvider 主题令牌、`zh_CN`）+ Tailwind CSS 4（只引 theme/utilities，不引 preflight）
- PostgreSQL 17 + Drizzle ORM / drizzle-kit
- jose 签名的无状态 httpOnly cookie 会话 + `@node-rs/argon2` 密码哈希
- Vitest（根级 workspace 配置）+ pnpm workspaces

## 本地开发（Quickstart）

### 方式 A：一键启动（全部在 Docker 中运行）

```bash
docker compose up --build
```

首次启动会构建镜像、安装依赖、执行数据库迁移，然后启动 Next.js 开发服务器；打开 http://localhost:3000 即可使用。

- 修改源码会自动热更新；修改 `package.json` / `pnpm-lock.yaml` 后需 `docker compose up --build` 重建镜像。
- 基础镜像默认 `node:20-alpine`（满足项目 `>=20.11` 要求；网络允许时可设 `NODE_VERSION=22` 或 `24` 升级）；依赖源默认 `https://registry.npmmirror.com`（适配国内网络），海外环境可设 `NPM_REGISTRY=https://registry.npmjs.org`。
- 数据保存在 `postgres_data` 卷中；`docker compose down` 停止，`docker compose down -v` 连同数据一起清空。
- 可在仓库根 `.env`（不入库）中覆盖 `WEB_PORT`（默认 3000）、`POSTGRES_PORT`（默认 5432）、`SESSION_SECRET`、`CRON_SECRET`。容器内 `DATABASE_URL` 固定指向 `postgres` 服务，**不需要** `apps/web/.env.local`。
- 与下面的「方式 B」不能同时运行（都会占用 3000 端口，PostgreSQL 端口也相同）。
- 若 macOS/Windows 下热更新不生效，先确认 Docker Desktop 的文件共享正常；compose 已为应用容器设置 `WATCHPACK_POLLING=true`。

### 方式 B：宿主机运行应用，Docker 只提供 PostgreSQL

以下步骤均在宿主机执行。

#### 0. 前置条件

- Node.js >= 20.11（含 Next.js 16 与 vitest 配置所需）
- pnpm 10（`corepack enable` 后由根 `packageManager` 字段自动选择版本）
- Docker（含 Compose v2）

#### 1. 安装依赖

```bash
pnpm install
```

#### 2. 启动 PostgreSQL

在仓库根目录执行：

```bash
docker compose up -d postgres
```

这里只启动 `postgres` 服务；直接 `docker compose up -d` 会连同 web 应用一起启动（见「方式 A」），与宿主机 `pnpm dev` 争用 3000 端口。

`docker-compose.yml`（仓库根）的 `postgres` 服务使用 `postgres:17-alpine`，容器内创建开发库 `open_doing`，并由 `docker/initdb` 下的初始化脚本创建测试库 `open_doing_test`（`01-create-test-db.sh`）与 Playwright e2e 库 `open_doing_e2e`（`02-create-e2e-db.sh`，供 e2e 用例使用）。

- 本机 5432 端口被占用时，用环境变量换端口：`POSTGRES_PORT=5433 docker compose up -d postgres`。`POSTGRES_PORT` 只被 Docker Compose 读取，请放在 shell 里或仓库根的 `.env`，**不要**写进 `apps/web/.env.local`；同时把 `.env.local` 里两个连接串的端口改成同一值。
- `docker/initdb` 中的脚本**只在数据卷为空时执行一次**。若数据卷是早期创建的、`open_doing_test` / `open_doing_e2e` 不存在：`docker compose down -v` 后重新启动（会清空数据），或手动执行 `CREATE DATABASE open_doing_test;` / `CREATE DATABASE open_doing_e2e;`。

#### 3. 配置环境变量

Next.js 从 `apps/web` 目录解析环境变量（不是仓库根），因此把示例文件复制到 `apps/web/.env.local`：

```bash
cp .env.example apps/web/.env.local
```

按需修改以下键：

| 变量 | 用途 |
|---|---|
| `DATABASE_URL` | **应用运行时 + 迁移**使用的开发库连接串（默认 `open_doing`） |
| `TEST_DATABASE_URL` | **仅测试**使用的独立测试库连接串（默认 `open_doing_test`）；由 `src/server/db/testing.ts` 重放迁移并清库，应用运行时永不使用 |
| `SESSION_SECRET` | 会话签名密钥；生产环境必须换成强随机值（如 `openssl rand -base64 32`） |
| `CRON_SECRET` | cron 路由鉴权密钥；生产环境同样必须替换 |

两个数据库必须指向**不同的库**（开发库 `open_doing` / 测试库 `open_doing_test`）：测试会清空 `TEST_DATABASE_URL` 指向的库，但不会触碰开发库。`TEST_DATABASE_URL` 未设置时数据库用例会跳过并打印提示。

`.env.local` 已被 `.gitignore` 忽略，不入库；需要新增变量时同步更新根目录的 `.env.example`。

#### 4. 运行数据库迁移

迁移只针对 `DATABASE_URL`（开发库）。drizzle-kit 读取的是 **shell 环境变量**（它不会自动加载 `apps/web/.env.local`），先把变量导入当前 shell，再执行迁移：

```bash
set -a; source apps/web/.env.local; set +a
pnpm --filter @open-doing/web db:migrate
```

修改 `apps/web/src/server/db/schema.ts` 后，用 `pnpm --filter @open-doing/web db:generate` 生成新迁移，再执行 `db:migrate`。迁移可在空库上重放。

#### 5. 写入示例数据（可选）

想直接看到与 `docs/prototypes` 一致的演示数据（团队、项目、任务、子任务、评论），在完成迁移后执行：

```bash
set -a; source apps/web/.env.local; set +a
pnpm --filter @open-doing/web db:seed
```

`db:seed` 会先重放迁移（空库也能直接执行），再写入以下数据：

| 用户名 | UID | 团队角色 |
|---|---|---|
| 林夏 | `doing_x7k2m9` | 管理员 |
| 周牧 | `doing_8f3qk2` | 所有者 |
| 陈默 | `doing_2vbd81` | 成员 |
| 苏晓 | `doing_5nqc04` | 成员 |
| 高远 | `doing_6wtp77` | 成员 |

- 统一密码：`seed-password`（仅用于本地开发）。推荐用 `林夏` 登录查看 `/my` 与「增长突击队」概览。
- 数据范围：团队「增长突击队」（3 个团队项目：官网改版 / 移动端 2.0 / Q4 用户增长活动）+ 林夏的 2 个个人项目（学习成长 / 生活琐事），共 29 个任务，覆盖逾期、今天/明天临期、已完成、无截止日期，以及子任务、评论和 1 个未指派团队任务。
- **日期以执行当天为锚**：原型基准日为 2026-10-21，原型日期 `D` 按 `今天 + (D - 2026-10-21)` 天落库，因此「今天/明天到期、已逾期」的相对状态在任何一天执行都成立。
- **幂等（守卫式跳过）**：脚本检测到 `林夏` / `doing_x7k2m9` 已存在时，打印「已初始化」并直接退出，不写入、不覆盖任何数据；全部写入在单个事务中完成，失败自动回滚。需要重建示例数据时，先清空开发库（例如 `docker compose down -v`，**会同时清空测试库与 e2e 库，慎用**）后重跑。
- seed 只读取 `DATABASE_URL`（开发库），不会触碰 `open_doing_test` / `open_doing_e2e`。

#### 6. 启动应用

```bash
pnpm dev
```

打开 http://localhost:3000：未登录会跳到 `/login`。注册（只需用户名 + 密码，无需邮箱）成功后自动登录并进入 `/my`（应用外壳 + 「我的任务」占位页）。

## 常用命令

以下命令均在仓库根目录执行：

```bash
pnpm dev          # 启动 web 应用（等价于 pnpm --filter @open-doing/web dev）
pnpm build        # 构建 web 应用
pnpm start        # 以生产构建启动
pnpm lint         # 对所有包执行 lint（目前为 apps/web）
pnpm typecheck    # 对所有包执行类型检查
pnpm test         # 运行全部 Vitest 用例（= pnpm test:run）
```

测试说明：

- 运行测试前先加载环境变量（vitest 不读取 `apps/web/.env.local`，否则数据库用例会静默跳过）：`set -a; source apps/web/.env.local; set +a`（bash/zsh），再执行 `pnpm test`。
- 数据库用例只读取 `TEST_DATABASE_URL`，会先重放 `apps/web/drizzle` 迁移并清空**测试库**，因此需要先 `docker compose up -d postgres`；未设置该变量时用例会跳过并打印提示。开发服务器始终连接 `DATABASE_URL`，运行测试不会清空开发数据。
- 多个测试文件共用同一个测试库，Vitest 配置为串行执行测试文件，避免互相清库。
- 类型检查顺序：Next 16 的路由类型由构建生成。干净 checkout 上请按 **`pnpm build`（或 `pnpm --filter @open-doing/web exec next typegen`）→ `pnpm typecheck`** 的顺序执行（本地与 CI 同序）；已有 `.next` 构建产物时可直接 `pnpm typecheck`。

新增内部包：在 `packages/` 下创建目录，以 `@open-doing/*` 命名，应用中通过 `"workspace:*"` 引用。

## 到期提醒 cron

`POST /api/cron/due-scan` 供外部 cron 定时调用：扫描「未完成、已指派、有截止日期」的任务，为今天/明天到期的任务生成 `task_due_soon` 通知，为已逾期的任务生成 `task_overdue` 通知。鉴权使用 `CRON_SECRET`（见上方环境变量表）：支持 `Authorization: Bearer <secret>` 或 `x-cron-key: <secret>`；`CRON_SECRET` 未配置或为空时一律返回 401。

本地手动触发（默认应用端口 3000）：

```bash
curl -X POST -H "Authorization: Bearer $CRON_SECRET" http://localhost:3000/api/cron/due-scan
```

crontab 示例（每天 09:00 触发一次；cron 使用所在服务器的时区，可配合 `CRON_TZ=Asia/Shanghai` 固定为上海时区）：

```cron
0 9 * * * curl -fsS -X POST -H "Authorization: Bearer <CRON_SECRET>" http://localhost:3000/api/cron/due-scan
```

成功返回 `{ "ok": true, "dueSoon": <本次新增数>, "overdue": <本次新增数> }`。

- **日期口径为 Asia/Shanghai**：「今天」按上海时区计算，与任务的截止日期（数据库 `date` 列）保持同一口径。
- **幂等**：重复调用不会重复生成通知；返回的 `dueSoon` / `overdue` 只统计本次真正新增的通知条数，因此紧接着再跑一次通常为 0（可用于验证幂等）。

## 领域模型要点

- 每个用户默认拥有**个人空间**；可创建**团队空间**并通过邀请加入成员。
- 团队 → 项目 → 任务；个人任务不归属项目。
- 任务包含：标题、描述、状态、责任人、截止日期、子任务、评论。
- 任务状态（未开始 / 进行中 / 已完成）**手动切换**。
- 任务进度：有子任务时按 `已完成子任务 / 子任务总数` 计算；无子任务时按状态映射（0 / 0.5 / 1）。定义见 `packages/types/src/index.ts`。
