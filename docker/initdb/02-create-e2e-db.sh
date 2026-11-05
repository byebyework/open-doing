#!/bin/sh
# 首次创建数据卷时，为 Playwright e2e 测试单独建库（open_doing_e2e）。
# 该脚本仅在容器初始化空数据目录时执行一次；已有数据卷不会重复执行。
set -e

mysql -u root -p"$MYSQL_ROOT_PASSWORD" -e "CREATE DATABASE IF NOT EXISTS open_doing_e2e CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci; GRANT ALL PRIVILEGES ON \`open\\_doing\\_e2e\`.* TO 'open-doing'@'%';"
