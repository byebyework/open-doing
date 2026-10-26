#!/usr/bin/env bash
#
# 运行 Playwright e2e，并在运行前后记录开发库 `open_doing` 与
# Vitest 测试库 `open_doing_test` 的行数快照；两者有变化则判失败。
#
# 目的：证明 e2e 只触碰 `open_doing_e2e`（Track X Task 2 / Review Focus 1）。
#
# 用法（任选其一）：
#   pnpm --filter @open-doing/web test:e2e
#   pnpm --filter @open-doing/web test:e2e -- flows/04-cron-reminder.spec.ts
#
# 连接 PostgreSQL 的顺序：本机 `psql`（PGPASSWORD）→ docker compose 的
# `postgres` 服务（`docker compose exec`）。两库名固定为开发库与测试库。
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WEB_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
ROOT_DIR="$(cd "$WEB_DIR/../.." && pwd)"
COMPOSE_FILE="$ROOT_DIR/docker-compose.yml"

POSTGRES_USER="${POSTGRES_USER:-open-doing}"
POSTGRES_PASSWORD="${POSTGRES_PASSWORD:-open-doing}"
POSTGRES_HOST="${POSTGRES_HOST:-localhost}"
POSTGRES_PORT="${POSTGRES_PORT:-5433}"

USE_DOCKER=0
if ! command -v psql >/dev/null 2>&1; then
  if [[ -n "$(docker compose -f "$COMPOSE_FILE" ps -q postgres 2>/dev/null || true)" ]]; then
    USE_DOCKER=1
  else
    echo "[e2e] 找不到 psql，且 docker compose 的 postgres 服务未运行；" >&2
    echo "[e2e] 请先执行 docker compose up -d --wait，或安装 psql。" >&2
    exit 1
  fi
fi

psql_exec() {
  local db="$1"
  shift
  # stdin 固定为 /dev/null：`docker compose exec -T` 会把 stdin 转发给容器，
  # 若继承调用方的 here-string，会提前耗尽逐表循环的输入。
  if [[ "$USE_DOCKER" -eq 1 ]]; then
    docker compose -f "$COMPOSE_FILE" exec -T postgres \
      psql -U "$POSTGRES_USER" -d "$db" "$@" </dev/null
  else
    PGPASSWORD="$POSTGRES_PASSWORD" psql \
      -h "$POSTGRES_HOST" -p "$POSTGRES_PORT" -U "$POSTGRES_USER" -d "$db" \
      "$@" </dev/null
  fi
}

# 逐表行数快照：`table=count;...`（按表名排序，输出稳定可比）。
snapshot_db() {
  local db="$1"
  local tables table row_count result=""

  tables="$(psql_exec "$db" -tAc \
    "SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename")"

  while IFS= read -r table; do
    [[ -z "$table" ]] && continue
    row_count="$(psql_exec "$db" -tAc "SELECT count(*) FROM \"$table\"")"
    result+="${table}=${row_count};"
  done <<<"$tables"

  printf '%s' "$result"
}

before_dev="$(snapshot_db open_doing)"
before_test="$(snapshot_db open_doing_test)"
echo "[e2e] open_doing 行数（运行前）：${before_dev}"
echo "[e2e] open_doing_test 行数（运行前）：${before_test}"

set +e
(
  cd "$WEB_DIR"
  pnpm exec playwright test "$@"
)
suite_status=$?
set -e

after_dev="$(snapshot_db open_doing)"
after_test="$(snapshot_db open_doing_test)"
echo "[e2e] open_doing 行数（运行后）：${after_dev}"
echo "[e2e] open_doing_test 行数（运行后）：${after_test}"

guard_status=0
if [[ "$before_dev" != "$after_dev" ]]; then
  echo "[e2e] 失败：open_doing 行数在 e2e 运行期间发生变化" >&2
  guard_status=1
fi
if [[ "$before_test" != "$after_test" ]]; then
  echo "[e2e] 失败：open_doing_test 行数在 e2e 运行期间发生变化" >&2
  guard_status=1
fi

if [[ "$guard_status" -eq 0 ]]; then
  echo "[e2e] 开发库与测试库行数未变化（隔离通过）"
fi

if [[ "$suite_status" -ne 0 ]]; then
  exit "$suite_status"
fi
exit "$guard_status"
