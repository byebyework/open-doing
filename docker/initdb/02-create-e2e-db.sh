#!/bin/sh
# 首次创建数据卷时，为 Playwright e2e 测试单独建库（open_doing_e2e）。
# 该脚本仅在容器初始化空数据目录时执行一次；已有数据卷不会重复执行。
set -e

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-EOSQL
  CREATE DATABASE open_doing_e2e;
EOSQL
