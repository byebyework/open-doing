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

### 0. 前置条件

- Node.js >= 20.11（含 Next.js 16 与 vitest 配置所需）
- pnpm 10（`corepack enable` 后由根 `packageManager` 字段自动选择版本）
- Docker（含 Compose v2）

### 1. 安装依赖

```bash
pnpm install
```

### 2. 启动 PostgreSQL

在仓库根目录执行：

```bash
docker compose up -d
```

`docker-compose.yml`（仓库根）启动 `postgres:17-alpine`，容器内创建开发库 `open_doing`，并由 `docker/initdb/01-create-test-db.sh` 创建测试库 `open_doing_test`。

- 本机 5432 端口被占用时，用环境变量换端口：`POSTGRES_PORT=5433 docker compose up -d`。`POSTGRES_PORT` 只被 Docker Compose 读取，请放在 shell 里或仓库根的 `.env`，**不要**写进 `apps/web/.env.local`；同时把 `.env.local` 里两个连接串的端口改成同一值。
- 初始化脚本只在数据卷为空时执行。若数据卷是早期创建的、测试库不存在：`docker compose down -v` 后重新启动（会清空数据），或手动 `CREATE DATABASE open_doing_test;`。

### 3. 配置环境变量

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

### 4. 运行数据库迁移

迁移只针对 `DATABASE_URL`（开发库）。drizzle-kit 读取的是 **shell 环境变量**（它不会自动加载 `apps/web/.env.local`），先把变量导入当前 shell，再执行迁移：

```bash
set -a; source apps/web/.env.local; set +a
pnpm --filter @open-doing/web db:migrate
```

修改 `apps/web/src/server/db/schema.ts` 后，用 `pnpm --filter @open-doing/web db:generate` 生成新迁移，再执行 `db:migrate`。迁移可在空库上重放。

### 5. 启动应用

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
- 数据库用例只读取 `TEST_DATABASE_URL`，会先重放 `apps/web/drizzle` 迁移并清空**测试库**，因此需要先 `docker compose up -d`；未设置该变量时用例会跳过并打印提示。开发服务器始终连接 `DATABASE_URL`，运行测试不会清空开发数据。
- 多个测试文件共用同一个测试库，Vitest 配置为串行执行测试文件，避免互相清库。
- 类型检查顺序：Next 16 的路由类型由构建生成。干净 checkout 上请按 **`pnpm build`（或 `pnpm --filter @open-doing/web exec next typegen`）→ `pnpm typecheck`** 的顺序执行（本地与 CI 同序）；已有 `.next` 构建产物时可直接 `pnpm typecheck`。

新增内部包：在 `packages/` 下创建目录，以 `@open-doing/*` 命名，应用中通过 `"workspace:*"` 引用。

## 领域模型要点

- 每个用户默认拥有**个人空间**；可创建**团队空间**并通过邀请加入成员。
- 团队 → 项目 → 任务；个人任务不归属项目。
- 任务包含：标题、描述、状态、责任人、截止日期、子任务、评论。
- 任务状态（未开始 / 进行中 / 已完成）**手动切换**。
- 任务进度：有子任务时按 `已完成子任务 / 子任务总数` 计算；无子任务时按状态映射（0 / 0.5 / 1）。定义见 `packages/types/src/index.ts`。
