#!/bin/sh
# 容器入口：先把依赖对齐到锁文件，再执行传入的命令。
# - 命名卷首次挂载为空时，这里会完成 pnpm install；
# - 宿主源码通过 bind mount 覆盖 /app，lockfile 变更后重新启动即可生效。
# 设置 SKIP_INSTALL=1 可跳过（例如已确认依赖卷是最新的）。
set -eu

if [ "${SKIP_INSTALL:-0}" != "1" ]; then
  pnpm install --frozen-lockfile
fi

exec "$@"
