# 香港服务器部署指南（docker-compose 内置 PostgreSQL，替代 Supabase）

> 本文是**数据库自托管版**的部署与运维指南：数据库从 Supabase 换成
> `docker-compose.hk-pg.yml` 内的 PostgreSQL 16（持久卷）。
> **仍然有效的旧文档章节**（`deploy-hk-server.md`）：§1.1 DNS/Cloudflare、
> §1.2 安全组/防火墙、§1.4 GHCR 拉取凭据（PAT）、§2.1 安装 Docker、
> §3 TLS 证书（Cloudflare Origin CA 签发）——本文直接引用，不重复。
> 旧文档中标注 Supabase `DATABASE_URL` 的章节（§2.3 后半、§4）已被本文取代。

```
浏览器 ── https://<域名> ──▶ Cloudflare 边缘（Always Use HTTPS）
                                │ TLS（边缘证书）
                                ▼
                            香港服务器
                              ├─ nginx 容器（TLS 终结 + 反代，443，CF Origin CA 证书）
                              ├─ web 容器（Next.js，127.0.0.1:3000，启动时自动迁移）
                              └─ postgres 容器（PostgreSQL 16，仅内网，持久卷 postgres_data）
```

镜像由 GitHub Actions 构建（`.github/workflows/build-push-ghcr.yml`，
**push main 自动触发** + 手动 workflow_dispatch 兜底），推到 GHCR；
**部署升级在服务器手动执行**（见 §5）。

## 1. 前置准备

按旧文档完成以下四项（命令与细节见 `deploy-hk-server.md` 对应章节）：

1. **DNS 迁 Cloudflare + 两条 Proxied A 记录**（§1.1）；
2. **防火墙只放行 443 / 22**（§1.2）；
3. **GHCR 拉取 PAT**（§1.4，`read:packages` 权限）；
4. **服务器安装 Docker**（§2.1）。

另：到仓库 **Actions → build-push-ghcr → Run workflow** 或直接 push 一次
main，确认两个 job（`web`、`nginx`）都绿、Packages 里出现两个包。

## 2. 部署文件与 .env

服务器部署目录统一 `/opt/open-doing`，放入三个文件：

```bash
cd /opt/open-doing
# 1) 编排文件（从仓库根拷贝）
cp docker-compose.hk-pg.yml .
mkdir -p docker/nginx && cp docker/nginx/hk.conf docker/nginx/
# 2) TLS 证书（§3 签发的 Cloudflare Origin CA 证书）
mkdir -p /opt/open-doing/certs   # 证书放这里，.env 的 CERT_DIR 指向它
```

创建 `.env`（**不要提交真实值**）：

```bash
cd /opt/open-doing
cat > .env <<'EOF'
POSTGRES_PASSWORD=<openssl rand -base64 32 生成>
BETTER_AUTH_SECRET=<openssl rand -base64 32 生成>
CRON_SECRET=<openssl rand -base64 32 生成>
BETTER_AUTH_URL=https://<域名>
CERT_DIR=/opt/open-doing/certs
EOF
chmod 600 .env
```

> 密钥类键在 compose 里都是 `${VAR:?…}` 必填：少一个 `up` 会直接报错，
> 不会静默用弱默认值。

## 3. 首次启动（建表）

```bash
cd /opt/open-doing
docker compose -f docker-compose.hk-pg.yml pull
docker compose -f docker-compose.hk-pg.yml up -d --wait
```

- `postgres` 健康后 `web` 启动，`docker/entrypoint.sh` 自动执行**幂等迁移**
  （`apps/web/scripts/migrate.mjs`）建全部业务表；
- 验证：`docker compose -f docker-compose.hk-pg.yml logs web | grep -i migrate`
  无报错；本机 `curl -k https://127.0.0.1/` 有响应（公网走域名 200）。

此时库里是**空表**。继续 §4 灌入 Supabase 存量数据；若全新项目无存量数据，
直接跳到 §5/§6。

## 4. Supabase → 新 PG 数据迁移（一次性）

**原则：先由迁移建好表，再灌数据**（不要先 restore 建表，避免与
drizzle 迁移记录打架）。本库主键全部是 `uuid`（无自增序列），
`--data-only` 灌入没有序列错位问题。

```bash
# 4.1 停 web（迁移期间不接流量；postgres 保持运行）
cd /opt/open-doing
docker compose -f docker-compose.hk-pg.yml stop web

# 4.2 从 Supabase 拉数据（连接串用 Dashboard → Connect 的 Session pooler，
#     带 ?sslmode=require；pg_dump 本机或服务器上执行均可）
pg_dump --data-only --no-owner --no-privileges \
  "postgres://postgres.<project-ref>:<Supabase密码>@aws-0-<region>.pooler.supabase.com:5432/postgres?sslmode=require" \
  -f supabase-data.sql

# 4.3 灌入新库（容器内 psql；ON_ERROR_STOP=0 容忍个别无关对象报错，末尾核对退出）
docker compose -f docker-compose.hk-pg.yml exec -T postgres \
  psql -v ON_ERROR_STOP=0 -U open-doing -d open_doing < supabase-data.sql

# 4.4 起 web
docker compose -f docker-compose.hk-pg.yml start web
```

**验证（对比 Supabase 控制台 / 源库）**：

```bash
docker compose -f docker-compose.hk-pg.yml exec -T postgres \
  psql -U open-doing -d open_doing -c "
select 'users' t, count(*) from users union all
select 'teams', count(*) from teams union all
select 'projects', count(*) from projects union all
select 'tasks', count(*) from tasks union all
select 'project_activities', count(*) from project_activities union all
select 'project_comments', count(*) from project_comments;"
```

行数与 Supabase 侧一致后，**登录冒烟**：账号密码登录、打开一个项目、
确认任务/评论齐全。确认无误前不要清掉 `supabase-data.sql`。

> 回滚：Supabase 源库在迁移窗口内保持原样不动；新库出问题可
> `docker compose … stop web` 后继续用旧链路（把旧 `docker-compose.hk.yml`
> 的 `.env` DATABASE_URL 指回 Supabase）作为临时回退。

## 5. 日常升级

```bash
# 服务器上（镜像已在 push main 时由 Actions 构建好）
cd /opt/open-doing
docker compose -f docker-compose.hk-pg.yml pull
docker compose -f docker-compose.hk-pg.yml up -d --force-recreate web
```

- 迁移仍由 web 启动时自动执行（幂等）；
- 回滚：`docker compose … pull` 指定旧 tag（把 `.env` 外的 image 写法改为
  `ghcr.io/byebyework/open-doing:<sha>`）后 `up -d --force-recreate web`。

## 6. 备份与恢复

```bash
# 备份（宿主机 crontab，每天 03:17；保留 14 天）
17 3 * * * cd /opt/open-doing && docker compose -f docker-compose.hk-pg.yml exec -T postgres pg_dump -U open-doing open_doing | gzip > /opt/open-doing/backups/open_doing_$(date +\%F).sql.gz && find /opt/open-doing/backups -name '*.sql.gz' -mtime +14 -delete

# 恢复（先 stop web，再灌，再 start web——同 §4 流程）
docker compose -f docker-compose.hk-pg.yml stop web
gunzip -c backups/open_doing_2026-11-27.sql.gz | docker compose -f docker-compose.hk-pg.yml exec -T postgres psql -v ON_ERROR_STOP=0 -U open-doing -d open_doing
docker compose -f docker-compose.hk-pg.yml start web
```

数据实际落在命名卷 `postgres_data`（完整名 = compose 顶层 `name` 加前缀：
`docker volume inspect open-doing-hk-pg_postgres_data`）；**卷在、数据在**，
但卷快照/迁移机器不能替代 pg_dump（逻辑备份才是权威）。

## 7. cron 到期扫描

宿主机 crontab（Bearer 即 `.env` 里的 `CRON_SECRET`）：

```bash
30 9 * * * curl -fsS -X POST -H "Authorization: Bearer $(grep ^CRON_SECRET /opt/open-doing/.env | cut -d= -f2)" http://127.0.0.1:3000/api/cron/due-scan
```

## 8. 常见问题

| 现象 | 原因 / 处理 |
|------|------|
| `docker compose up` 报 `set POSTGRES_PASSWORD in .env` | 仓库根（部署目录）缺 `.env` 或键缺失，按 §2 补齐 |
| 拉镜像 403 / denied | GHCR 包私有：先按旧文档 §1.4 用 PAT `docker login ghcr.io` |
| web 反复重启、日志 `BETTER_AUTH_SECRET` 报错 | `.env` 缺该键或为空 |
| 迁移报错（首次启动） | 看 `logs web`；旧 Supabase 数据未灌前表是空的，迁移只建表，报错多为连接/权限问题 |
| 443 被占用 | 与宿主机已有 nginx 冲突：停用宿主机 nginx 或改 `docker-compose.hk-pg.yml` 的端口映射 |
| 换机器搬数据 | 旧机 `pg_dump` + 新机按 §4 流程；或直接搬 `postgres_data` 卷（同大版本 PG16） |
