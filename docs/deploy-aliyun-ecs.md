# 阿里云 ECS 部署运维手册

> 架构与决策依据见 `docs/superpowers/specs/2026-11-12-aliyun-ecs-deployment-design.md`。
> 部署目录统一为 `/opt/open-doing`。本文所有 `<域名>` / `<ns>` / 密钥均为占位符，执行前替换；任何真实凭据不得提交进仓库。

```
浏览器 ── https://<域名>:8443 ──▶ ECS
                                   ├─ nginx 容器（TLS 终结 + 反代，监听 8443）
                                   └─ web 容器（Next.js，只绑 127.0.0.1:3000）
                                        │ TLS（session pooler）
                                        ▼
                                   Supabase（亚洲区）
```

## 1. 前置准备

### 1.1 阿里云 DNS

给裸域与 `www` 各加一条 **A 记录**指向 ECS 公网 IP。

> 注意：备案通过前 80/443 不可用，这与 DNS 记录无关——A 记录现在就可以加，将来备案通过后无需改 DNS，只需 nginx 加 443 监听。

### 1.2 安全组

ECS 控制台 → 安全组 → 入方向添加规则：

| 协议 | 端口 | 授权对象 | 说明 |
|------|------|----------|------|
| TCP | 8443 | 0.0.0.0/0 | 应用唯一公网入口 |
| TCP | 22 | 你的常用 IP | SSH（按现状保留即可） |

**不要放行 80/443**（未备案域名无效且徒增暴露面）。

### 1.3 ACR 个人版（容器镜像服务）

1. 开通「容器镜像服务个人版」，实例地域与 **ECS 同地域**（同地域走 VPC 内网 endpoint，免流量费）；
2. 创建命名空间 `<ns>`；
3. 创建两个仓库：`<ns>/open-doing`、`<ns>/open-doing-nginx`（或把命名空间的仓库类型设为「自动创建」）；
4. 「访问凭证」页设置**固定密码**，记为 `ACR_USERNAME`（即阿里云账号）/ `ACR_PASSWORD`。

### 1.4 GitHub 仓库配置

仓库 Settings → Secrets and variables → Actions：

| 类型 | 名字 | 值 |
|------|------|----|
| Variable | `ACR_REGISTRY` | 如 `registry.cn-hangzhou.aliyuncs.com`（与 ECS 同地域） |
| Variable | `ACR_NAMESPACE` | `<ns>` |
| Secret | `ACR_USERNAME` | 1.3 的用户名 |
| Secret | `ACR_PASSWORD` | 1.3 的固定密码 |

然后到 Actions 页手动触发 `build-push-acr` workflow。**判定**：ACR 控制台出现两个镜像——`open-doing`（tag `latest` + git sha）与 `open-doing-nginx:1.27-alpine`。

## 2. ECS 初始化

### 2.1 安装 Docker

```bash
# 阿里云软件源安装 docker-ce + compose 插件（Alibaba Cloud Linux / CentOS 系）
sudo dnf config-manager --add-repo https://mirrors.aliyun.com/docker-ce/linux/centos/docker-ce.repo
sudo sed -i 's+download.example.com+mirrors.aliyun.com+' /etc/yum.repos.d/docker-ce.repo
sudo dnf install -y docker-ce docker-compose-plugin
sudo systemctl enable --now docker
docker compose version   # 判定：输出 compose 版本号
```

Ubuntu/Debian 系把 `dnf` 换成 `apt-get`（软件源同样用 `mirrors.aliyun.com/docker-ce`）。镜像加速可配置 `/etc/docker/daemon.json` 的 `registry-mirrors`（本仓库此前验证过 `https://docker.1ms.run` 可用）。

### 2.2 部署文件

从本机把所需文件送上去（仓库小、无 CI 拉取需求，scp 最直接）：

```bash
ssh root@<ECS公网IP> 'mkdir -p /opt/open-doing/docker/nginx /opt/open-doing/certs'
scp docker-compose.aliyun.yml root@<ECS公网IP>:/opt/open-doing/
scp docker/nginx/aliyun.conf root@<ECS公网IP>:/opt/open-doing/docker/nginx/
```

**替换占位符**（必须，否则 nginx 不认你的域名）：

```bash
ssh root@<ECS公网IP> "sed -i 's/<域名>/你的真实域名/g' /opt/open-doing/docker/nginx/aliyun.conf"
grep server_name /opt/open-doing/docker/nginx/aliyun.conf   # 判定：两处均为真实域名
```

### 2.3 创建 `.env`

```bash
ssh root@<ECS公网IP>
cat > /opt/open-doing/.env <<'EOF'
WEB_IMAGE=<ACR_REGISTRY>/<ns>/open-doing:latest
NGINX_IMAGE=<ACR_REGISTRY>/<ns>/open-doing-nginx:1.27-alpine
DATABASE_URL=postgres://postgres.<project-ref>:<Supabase密码>@aws-0-<region>.pooler.supabase.com:5432/postgres?sslmode=require
BETTER_AUTH_SECRET=<openssl rand -base64 32 的输出>
CRON_SECRET=<openssl rand -base64 32 的输出>
BETTER_AUTH_URL=https://<域名>:8443
CERT_DIR=/opt/open-doing/certs
EOF
chmod 600 /opt/open-doing/.env
```

两个 secret 在 ECS 上生成：`openssl rand -base64 32`。

> **`BETTER_AUTH_URL` 必须带 `:8443`**——better-auth 从请求推断 base URL 时会丢非标端口，缺了它登录回跳全断。
> **`DATABASE_URL` 必须用 Supabase 的 session pooler（5432 端口）**并带 `?sslmode=require`；不要用直连地址（仅 IPv6，ECS 无 IPv6），也不要用 transaction pooler（6543，prepared statements 会失效）。

## 3. TLS 证书（acme.sh，DNS-01）

### 3.1 RAM 子账号

阿里云控制台 → RAM 访问控制 → 创建子用户（仅编程访问），授权 **`AliyunDNSFullAccess`**，生成 AccessKey。**只给 DNS 权限**，不要用主账号 AK。

### 3.2 安装与签发

```bash
curl https://get.acme.sh | sh -m <email>
# 大陆网络拉不动时：本机 git clone https://github.com/acmesh-official/acme.sh 后 scp 到 ECS，在目录内 ./acme.sh --install

export Ali_Key=<子账号 AccessKey ID>
export Ali_Secret=<子账号 AccessKey Secret>
~/.acme.sh/acme.sh --issue --dns dns_ali -d <域名> -d www.<域名>
```

**判定**：输出 `Cert success`，证书落在 `~/.acme.sh/<域名>_ecc/`。

### 3.3 安装到部署目录（续期钩子在此绑定）

```bash
~/.acme.sh/acme.sh --install-cert -d <域名> \
  --fullchain-file /opt/open-doing/certs/fullchain.pem \
  --key-file /opt/open-doing/certs/privkey.pem \
  --reloadcmd "docker compose -f /opt/open-doing/docker-compose.aliyun.yml exec nginx nginx -s reload"
```

**判定**：`/opt/open-doing/certs/` 下出现 `fullchain.pem` 与 `privkey.pem`。

> reloadcmd 此刻报 reload 失败属预期（nginx 容器还没起）——acme.sh 每次续期成功后都会重跑这条命令，容器在跑时它就是续期后的平滑重载。首次 `up` 之后手动跑一遍这条 reload 命令确认路径可用（见 5.2）。

## 4. 数据库迁移前检查（存量数据保护）

web 容器首启会自动对 `DATABASE_URL` 跑幂等迁移（`docker/entrypoint.sh` → `migrate.mjs`）。Supabase 库里有存量数据需要保留，所以**启动前先拍照**：

在 Supabase Dashboard 的 SQL Editor（或本机 `psql "$DATABASE_URL"`）执行：

```sql
select table_name
from information_schema.tables
where table_schema = 'public'
order by table_name;
```

对查出的每张表记一行行数（可写成循环或逐条执行）：

```sql
select '<表名>' as tbl, count(*) from public.<表名>;
```

把这两份输出保存下来作为「迁移前基线」。

**规则（硬性）**：迁移只做增量 DDL。首启若迁移报对象冲突（同名表、字段类型不一致等），**停下来报告、查明原因**——禁止 drop / truncate、禁止改迁移文件或跳过迁移绕过去。库里的存量数据比首次部署时间贵。

## 5. 启动与验证清单

### 5.1 启动

```bash
cd /opt/open-doing
docker compose -f docker-compose.aliyun.yml up -d
docker compose -f docker-compose.aliyun.yml ps   # 判定：web、nginx 均为 running
```

### 5.2 逐项验证

| # | 检查 | 命令 | 判定 |
|---|------|------|------|
| 1 | 迁移日志无报错 | `docker compose -f docker-compose.aliyun.yml logs web \| grep -i migrat` | 无 error/conflict；对照第 4 节基线重跑行数查询，存量数据完好 |
| 2 | 3000 只绑回环 | `ss -tlnp \| grep 3000` | `127.0.0.1:3000`，**不是** `0.0.0.0:3000`（否则公网绕过 nginx 直达 web） |
| 3 | 8443 本机可服务 | `curl -sk https://127.0.0.1:8443 -H 'Host: <域名>' -o /dev/null -w '%{http_code}'` | 返回 200 或 30x |
| 4 | 续期钩子路径可用 | `docker compose -f docker-compose.aliyun.yml exec nginx nginx -s reload` | 无报错（3.3 的 reloadcmd 依赖此命令） |
| 5 | 公网 HTTPS | 浏览器开 `https://<域名>:8443` | 落地页正常渲染，证书有效 |
| 6 | **登录流程走通** | 注册/登录一个真实账号 | **登录后不被登出、跳转正常**（`BETTER_AUTH_URL` 缺 `:8443` 时会在这里爆，见 2.3） |
| 7 | cron 端点可用 | `curl -fsS -X POST -H "Authorization: Bearer $(grep -E '^CRON_SECRET=' /opt/open-doing/.env \| cut -d= -f2)" http://127.0.0.1:3000/api/cron/due-scan` | 成功响应；对应通知产生（如果今天确有到期任务） |

## 6. crontab（每日 09:00 到期扫描）

```bash
sudo crontab -e
```

写入（`TZ` 行必须在 crontab 里，ECS 默认 UTC，不钉时区提醒会在凌晨 1 点发）：

```cron
TZ=Asia/Shanghai
0 9 * * * curl -fsS -X POST -H "Authorization: Bearer $(grep -E '^CRON_SECRET=' /opt/open-doing/.env | cut -d= -f2)" http://127.0.0.1:3000/api/cron/due-scan >> /var/log/od-due-scan.log 2>&1
```

**验证**：手动把时间改成两分钟后观察一次触发（或直接按 5.2 表第 7 项手动 curl）；`grep TZ /var/log/syslog` 不一定有输出，以「手动跑 5.2-7 成功 + crontab 里 TZ 行存在」为准。Debian 系 cron 支持 crontab 内 `TZ=` 变量；Alibaba Cloud Linux（vixie-cron）同样支持。

## 7. 日常更新

```bash
# 1. 本机：Actions 页手动触发 build-push-acr（构建并 push latest + git sha）
# 2. ECS：
cd /opt/open-doing
docker compose -f docker-compose.aliyun.yml pull web
docker compose -f docker-compose.aliyun.yml up -d
```

- `latest` 永远指向最近一次成功构建；git sha tag 用于回滚：把 `.env` 里 `WEB_IMAGE` 的 tag 换成上一个正常工作的 sha，再 `pull web && up -d`。
- 数据库迁移随容器启动自动执行（幂等）；跨版本升级前照例跑一遍第 4 节的基线对比。
