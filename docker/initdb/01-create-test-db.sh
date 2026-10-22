#!/bin/sh
# 首次创建数据卷时，为本地测试单独建库（open_doing_test）。
# 该脚本仅在容器初始化空数据目录时执行一次。
set -e

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-EOSQL
  CREATE DATABASE open_doing_test;
EOSQL
