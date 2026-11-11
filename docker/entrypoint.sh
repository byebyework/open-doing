#!/bin/sh
# open-doing 生产容器入口：先执行数据库迁移（幂等），再启动 Next.js 生产服务器。
#
# - 迁移由 apps/web/scripts/migrate.mjs 完成（仅依赖运行时依赖，语义与
#   drizzle-kit migrate 一致；连接失败按 MIGRATE_MAX_RETRIES 重试）。
# - 设 SKIP_DB_MIGRATION=1 可跳过迁移（例如由外部 Job / init container 统一执行，
#   多副本部署时建议只让一个入口跑迁移）。
# - 迁移成功后 exec 交出 PID 1，停止信号由 next 进程直接接收。
set -eu

cd /app/apps/web

if [ "${SKIP_DB_MIGRATION:-0}" = "1" ]; then
  echo "[entrypoint] SKIP_DB_MIGRATION=1, skipping database migration"
else
  echo "[entrypoint] running database migrations..."
  node scripts/migrate.mjs
fi

exec node_modules/.bin/next start -H 0.0.0.0 -p "${PORT:-3000}"
