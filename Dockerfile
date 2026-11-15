# syntax=docker/dockerfile:1
#
# open-doing 生产镜像（多阶段构建）。
#
# 构建上下文为仓库根目录（monorepo 根），例如：
#   docker build -t open-doing:latest .
#
# 运行时需要的环境变量（不要打进镜像）：
#   DATABASE_URL         生产库连接串（必填，启动前由 entrypoint 执行迁移）
#   BETTER_AUTH_SECRET   会话签名密钥（生产必填，缺失时 better-auth 启动抛错）
#   CRON_SECRET          cron 路由鉴权密钥
#   PORT                 监听端口（默认 3000）
#   SKIP_DB_MIGRATION    设为 1 跳过启动时迁移（改由外部 Job / init container 负责）
#
# 构建期变量（web 客户端产物内联）：NEXT_PUBLIC_MCP_BASE_URL（API Token 弹层展示的
# MCP 公网地址，带结尾斜杠，如 https://<域名>/mcp/；缺省回退 `${origin}/mcp/`）。
#
# 镜像有两个最终 stage：
#   runtime      —— web（Next.js + 启动时幂等迁移，入口 docker/entrypoint.sh）
#   runtime-mcp  —— 独立 MCP 服务（apps/mcp，不执行迁移；端口 MCP_PORT 默认 3101）
# 两者来自同一个构建上下文与依赖图，compose 通过 target 选择。
#
# 部署示例见仓库根 docker-compose.prod.yml 与 docker-compose.hk.yml。

# ---- base：Node + pnpm（corepack 按 packageManager 字段锁定版本）----
FROM node:22-bookworm-slim AS base
WORKDIR /repo
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0 \
    npm_config_manage_package_manager_versions=false
RUN corepack enable
# .npmrc（npmmirror）随构建上下文 COPY 进来后生效；corepack 下载 pnpm 也走镜像源
COPY .npmrc /root/.npmrc

# ---- deps：全量依赖（含 devDependencies，next build 需要）----
FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/web/package.json apps/web/
COPY apps/mcp/package.json apps/mcp/
COPY packages/types/package.json packages/types/
COPY packages/server-core/package.json packages/server-core/
RUN pnpm install --frozen-lockfile

# ---- build：Turbopack 生产构建（产物 .next）----
FROM base AS build
ENV NEXT_TELEMETRY_DISABLED=1
# 构建元数据（关于系统页展示）：构建时由 CI 传入，例如
#   --build-arg GIT_COMMIT_SHA=$(git rev-parse HEAD) --build-arg BUILD_TIME="..."
# Next 在构建期内联 process.env 读取；缺省为空，页面显示「未知（开发模式）」。
ARG GIT_COMMIT_SHA=""
ARG BUILD_TIME=""
# MCP 公网地址：Next.js 构建期把 NEXT_PUBLIC_* 内联进客户端产物，必须在此注入；
# 缺省空值 → 客户端回退到 `${window.location.origin}/mcp/`。
ARG NEXT_PUBLIC_MCP_BASE_URL=""
ENV GIT_COMMIT_SHA=${GIT_COMMIT_SHA} \
    BUILD_TIME=${BUILD_TIME} \
    NEXT_PUBLIC_MCP_BASE_URL=${NEXT_PUBLIC_MCP_BASE_URL}
# 根清单必须存在：Turbopack 靠最近的 lockfile 定位 monorepo workspace 根（/repo），
# 缺失时会把解析根钉在 apps/web，导致 pnpm 符号链接的 node_modules 被视为根外文件。
COPY --from=deps /repo/package.json /repo/pnpm-lock.yaml /repo/pnpm-workspace.yaml ./
COPY --from=deps /repo/node_modules node_modules
COPY --from=deps /repo/apps/web/node_modules apps/web/node_modules
COPY --from=deps /repo/apps/mcp/node_modules apps/mcp/node_modules
COPY --from=deps /repo/packages/types/node_modules packages/types/node_modules
COPY --from=deps /repo/packages/server-core/node_modules packages/server-core/node_modules
COPY packages/types packages/types
COPY packages/server-core packages/server-core
COPY apps/mcp apps/mcp
COPY apps/web apps/web
# 构建期不注入真实密钥：页面按会话取数均为动态渲染，构建不发生数据库连接、
# 不签发任何会话。但收集页面数据时会 import db client 与 better-auth 初始化
# （生产模式缺失 DATABASE_URL / BETTER_AUTH_SECRET 直接抛错，连 /_not-found
# 也会经由 layout 触达），因此给占位值，仅满足模块加载；
# 真正的 DATABASE_URL / BETTER_AUTH_SECRET 在运行时由容器环境注入。
# NEXT_SKIP_TYPECHECK：Docker VM 内存有限，tsc 阶段易被 OOM kill；
# 类型检查由本地/CI 的 `pnpm typecheck` 负责（见 next.config.ts 内注释）。
ENV DATABASE_URL=postgres://build-time-placeholder.invalid:5432/open_doing \
    BETTER_AUTH_SECRET=build-time-placeholder \
    NEXT_SKIP_TYPECHECK=1
RUN pnpm --filter @open-doing/web build

# ---- prod-deps：仅运行时依赖（迁移脚本 migrate.mjs 只依赖 drizzle-orm + postgres）----
FROM base AS prod-deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/web/package.json apps/web/
COPY apps/mcp/package.json apps/mcp/
COPY packages/types/package.json packages/types/
COPY packages/server-core/package.json packages/server-core/
RUN pnpm install --prod --frozen-lockfile

# ---- runtime：生产运行时 ----
FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000

COPY --from=prod-deps /repo/node_modules node_modules
COPY --from=prod-deps /repo/apps/web/node_modules apps/web/node_modules
COPY --from=build --chown=node:node /repo/apps/web/.next apps/web/.next
COPY apps/web/package.json apps/web/next.config.ts apps/web/
COPY apps/web/public apps/web/public
# 迁移脚本与其重放的迁移目录（entrypoint 在启动前执行）
COPY apps/web/drizzle apps/web/drizzle
COPY apps/web/scripts/migrate.mjs apps/web/scripts/migrate.mjs
# packages/types 为 TS 源码包（构建期已内联），此处冗余拷贝仅为模块解析兜底
COPY packages/types packages/types
COPY docker/entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

USER node
WORKDIR /app/apps/web
EXPOSE 3000
ENTRYPOINT ["docker-entrypoint.sh"]

# ---- runtime-mcp：独立 MCP 服务运行时（compose target: runtime-mcp）----
# 与 web 共用同一依赖图与构建上下文，但：
# - 不执行数据库迁移（迁移所有权只在 web）；
# - 直接以 tsx 运行 apps/mcp 的 TS 源码（server-core 同为源码包，无构建步骤）；
# - 监听 MCP_PORT（默认 3101），健康检查 GET /healthz。
FROM prod-deps AS runtime-mcp
ENV NODE_ENV=production
COPY packages/types packages/types
COPY packages/server-core packages/server-core
COPY apps/mcp apps/mcp

USER node
WORKDIR /repo/apps/mcp
EXPOSE 3101
# 直接调用 tsx 的入口文件，避免依赖 .bin 符号链接 / pnpm / corepack 在运行时的存在。
CMD ["node", "node_modules/tsx/dist/cli.mjs", "src/main.ts"]
