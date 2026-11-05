#!/bin/sh
# 首次创建数据卷时，为本地测试单独建库（open_doing_test）。
# 该脚本仅在容器初始化空数据目录时执行一次。
set -e

mysql -u root -p"$MYSQL_ROOT_PASSWORD" -e "CREATE DATABASE IF NOT EXISTS open_doing_test CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci; GRANT ALL PRIVILEGES ON \`open\\_doing\\_test\`.* TO 'open-doing'@'%';"
