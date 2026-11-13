# 香港服务器部署运维手册

> 架构与决策依据见 `docs/superpowers/specs/2026-11-12-aliyun-ecs-deployment-design.md`（早期阿里云大陆方案的设计文档，香港方案的差异：标准 443、镜像源 GHCR、无备案约束）。
> 部署目录统一为 `/opt/open-doing`。本文所有 `<域名>` / 密钥均为占位符，执行前替换；任何真实凭据不得提交进仓库。

```
浏览器 ── https://<域名> ──▶ Cloudflare 边缘（大陆可达；Always Use HTTPS）
                                │ TLS（边缘证书）
                                ▼
                            香港服务器
                              ├─ nginx 容器（TLS 终结 + 反代，监听 443，CF Origin CA 证书）
                              └─ web 容器（Next.js，只绑 127.0.0.1:3000）
                                   │ TLS（session pooler）
                                   ▼
                              Supabase（亚洲区）
```

> **为什么前面套 Cloudflare**：实测大陆到该香港 IP（阿里云轻量）的跨境链路被劣化（TCP 全端口超时、ping 丢包），而服务器本身完全正常（海外可达 + 本机自测 200）。CF 边缘节点大陆可达性好，CF→香港源站走海外段不受影响，同时顺带解决 http→https 跳转与源站 IP 隐藏。

## 1. 前置准备

### 1.1 DNS 迁到 Cloudflare（大陆可达性的关键）

1. 注册/登录 Cloudflare → Add a domain → 填 `byebyework.cn`（Free 计划）；
2. Cloudflare 会分配两个 NS（形如 `xxx.ns.cloudflare.com`）；
3. 阿里云域名控制台（`dc.console.aliyun.com`）→ 域名 `byebyework.cn` → **管理 → DNS 修改 → 修改 DNS 服务器**，把默认的阿里云 DNS 换成 Cloudflare 的两个 NS（.cn 域名允许使用境外解析服务，实名认证不受影响）；
4. 等待 NS 生效（Cloudflare 页面会显示 Pending，通常几分钟到几小时，最长 48h）；
5. 生效后在 Cloudflare **DNS** 页添加两条记录（**橙色云朵 = Proxied 必须开启**，这就是回源香港的通道）：

| 类型 | 名称 | 内容 | 代理 |
|------|------|------|------|
| A | `@` | `8.217.57.28`（服务器公网 IP） | Proxied |
| A | `www` | `8.217.57.28` | Proxied |

6. Cloudflare **SSL/TLS → Overview**：模式设为 **Full (strict)**；
7. Cloudflare **SSL/TLS → Edge Certificates**：开启 **Always Use HTTPS**（从此 `http://` 请求在 CF 边缘直接 301 到 https，80 端口不需要源站监听）。

> NS 迁移后阿里云 DNS 上的原记录即作废——之后所有解析都在 Cloudflare 管。

### 1.2 安全组 / 防火墙

入方向放行（轻量应用服务器控制台 → 实例 → 防火墙）：

| 协议 | 端口 | 授权对象 | 说明 |
|------|------|----------|------|
| TCP | 443 | 0.0.0.0/0 | Cloudflare 回源通道（CF 回源 IP 段固定，也可收紧为 CF IP 列表） |
| TCP | 22 | 你的常用 IP | SSH |

> 不放行 80：Always Use HTTPS 已在 CF 边缘处理跳转，源站无需 80。

### 1.3 触发镜像构建

镜像由 `.github/workflows/build-push-ghcr.yml`（手动触发）构建并 push 到 GHCR：

- `ghcr.io/byebyework/open-doing:{latest,<git-sha>}`
- `ghcr.io/byebyework/open-doing-nginx:1.27-alpine`

到仓库 **Actions → build-push-ghcr → Run workflow**（选 main 分支）触发。**判定**：Actions 两个 job（`web`、`nginx`）都绿，仓库 Packages 页出现两个包。

**GHCR 包可见性**：首次 push 后包是**私有的**。本方案保持私有（镜像含编译产物，不公开），服务器拉取用 PAT 登录，见 2.3。

### 1.4 创建 GHCR 拉取凭据（PAT）

GitHub → Settings → Developer settings → **Personal access tokens (classic)** → Generate new token：

- 勾选权限：**`read:packages`**（只读，足够 pull；不要给 write）
- 生成的 token 记为 `<GHCR_PAT>`，只在服务器登录时用一次

### 1.2 安全组 / 防火墙

入方向放行：

| 协议 | 端口 | 授权对象 | 说明 |
|------|------|----------|------|
| TCP | 443 | 0.0.0.0/0 | 应用唯一公网入口 |
| TCP | 22 | 你的常用 IP | SSH（按现状保留即可） |

### 1.3 触发镜像构建

镜像由 `.github/workflows/build-push-ghcr.yml`（手动触发）构建并 push 到 GHCR：

- `ghcr.io/byebyework/open-doing:{latest,<git-sha>}`
- `ghcr.io/byebyework/open-doing-nginx:1.27-alpine`

到仓库 **Actions → build-push-ghcr → Run workflow**（选 main 分支）触发。**判定**：Actions 两个 job（`web`、`nginx`）都绿，仓库 Packages 页出现两个包。

**GHCR 包可见性**：首次 push 后包是**私有的**。本方案保持私有（镜像含编译产物，不公开），服务器拉取用 PAT 登录，见 2.3。

### 1.4 创建 GHCR 拉取凭据（PAT）

GitHub → Settings → Developer settings → **Personal access tokens (classic)** → Generate new token：

- 勾选权限：**`read:packages`**（只读，足够 pull；不要给 write）
- 生成的 token 记为 `<GHCR_PAT>`，只在服务器登录时用一次

## 2. 服务器初始化

### 2.1 安装 Docker

香港服务器可直连 Docker Hub，无需配置镜像加速：

```bash
# Alibaba Cloud Linux / CentOS 系
sudo dnf install -y dnf-plugins-core   # config-manager 依赖它，最小化镜像常不带
sudo dnf config-manager --add-repo https://download.docker.com/linux/centos/docker-ce.repo
sudo dnf install -y docker-ce docker-compose-plugin
sudo systemctl enable --now docker
docker compose version   # 判定：输出 compose 版本号
```

Ubuntu/Debian 系改用 `apt-get`（官方源 `download.docker.com/linux/ubuntu`）。

### 2.2 部署文件

从本机把所需文件送上去（scp 最直接）：

```bash
ssh <user>@<HK公网IP> 'mkdir -p /opt/open-doing/docker/nginx /opt/open-doing/certs'
scp docker-compose.hk.yml <user>@<HK公网IP>:/opt/open-doing/
scp docker/nginx/hk.conf <user>@<HK公网IP>:/opt/open-doing/docker/nginx/
```

**替换占位符**（必须，否则 nginx 不认你的域名）：

```bash
ssh <user>@<HK公网IP> "sed -i 's/<域名>/你的真实域名/g' /opt/open-doing/docker/nginx/hk.conf"
grep server_name /opt/open-doing/docker/nginx/hk.conf   # 判定：server_name 行的两个 token 均为真实域名
```

### 2.3 登录 GHCR 并创建 `.env`

```bash
ssh <user>@<HK公网IP>
# GHCR 包默认私有，必须登录才能 pull（PAT 走 stdin，不进 shell 历史/进程列表）
docker login ghcr.io --username <GitHub用户名> --password-stdin
# 提示符处粘贴 1.4 的 <GHCR_PAT> 后回车；判定：Login Succeeded

cat > /opt/open-doing/.env <<'EOF'
DATABASE_URL=postgres://postgres.<project-ref>:<Supabase密码>@aws-0-<region>.pooler.supabase.com:5432/postgres?sslmode=require
BETTER_AUTH_SECRET=<openssl rand -base64 32 的输出>
CRON_SECRET=<openssl rand -base64 32 的输出>
BETTER_AUTH_URL=https://<域名>
CERT_DIR=/opt/open-doing/certs
EOF
chmod 600 /opt/open-doing/.env
```

两个 secret 在服务器上生成：`openssl rand -base64 32`。

> **`DATABASE_URL` 必须用 Supabase 的 session pooler（5432 端口）**并带 `?sslmode=require`；不要用直连地址（仅 IPv6），也不要用 transaction pooler（6543，prepared statements 会失效）。
> `BETTER_AUTH_URL` 写 `https://<域名>` 即可——443 是 https 默认端口，不需要端口号。

## 3. TLS 证书（Cloudflare Origin CA，15 年免续期）

> 域名的 NS 已迁到 Cloudflare（1.1），浏览器看到的证书由 CF 边缘自动签发和维护；
> 源站只需要一张 **CF Origin CA 证书**，仅用于 CF→源站这一跳的加密与校验（配合 SSL/TLS 模式 Full (strict)）。
> Origin CA 证书浏览器不信任，但 CF 信任——所以本机自测要加 `-k`，公网访问不需要。
> 原方案的 acme.sh + 阿里云 RAM AccessKey 整套不再需要（DNS 验证依赖 NS 在阿里云，已迁走）。

### 3.1 签发 Origin CA 证书

Cloudflare 控制台 → SSL/TLS → **Origin Server** → Create Certificate：

- 私钥类型：RSA (2048)；Hosts：`byebyework.cn, *.byebyework.cn`；有效期：15 years
- 页面会给出 **Origin Certificate**（证书）与 **Private Key**（私钥）两段 PEM 文本

**判定**：证书信息页显示有效期为 15 年。

### 3.2 安装到服务器

本机把两段文本分别存成文件后送上去（对应 nginx 挂载约定）：

```bash
# 本机执行；文件名必须与 docker/nginx/hk.conf 引用一致
cat > fullchain.pem   # 粘贴 Origin Certificate 内容，Ctrl-D 结束
cat > privkey.pem     # 粘贴 Private Key 内容，Ctrl-D 结束
scp fullchain.pem privkey.pem <user>@<HK公网IP>:/opt/open-doing/certs/
rm fullchain.pem privkey.pem   # 本机不留私钥副本
```

服务器上核对：

```bash
ls -l /opt/open-doing/certs/          # 判定：fullchain.pem、privkey.pem 都在
openssl x509 -in /opt/open-doing/certs/fullchain.pem -noout -subject -enddate
# 判定：subject 含 Cloudflare/byebyework.cn，有效期 15 年
```

> Origin CA 证书 15 年免续期，crontab / acme.sh 续期钩子都不需要；若将来重建证书，覆盖这两个文件后 `docker compose -f docker-compose.hk.yml exec nginx nginx -s reload` 即可。

## 4. 数据库迁移前检查（存量数据保护）

web 容器首启会自动对 `DATABASE_URL` 跑幂等迁移（`docker/entrypoint.sh` → `migrate.mjs`）。Supabase 库里有存量数据需要保留，所以**启动前先拍照**：

在 Supabase Dashboard 的 SQL Editor（或本机 `psql "$DATABASE_URL"`）执行：

```sql
select table_name
from information_schema.tables
where table_schema = 'public'
order by table_name;
```

对查出的每张表记一行行数：

```sql
select '<表名>' as tbl, count(*) from public.<表名>;
```

把这两份输出保存下来作为「迁移前基线」。

**规则（硬性）**：迁移只做增量 DDL。首启若迁移报对象冲突（同名表、字段类型不一致等），**停下来报告、查明原因**——禁止 drop / truncate、禁止改迁移文件或跳过迁移绕过去。库里的存量数据比首次部署时间贵。

## 5. 启动与验证清单

### 5.1 启动

```bash
cd /opt/open-doing
docker compose -f docker-compose.hk.yml up -d
docker compose -f docker-compose.hk.yml ps   # 判定：web、nginx 均为 running
```

### 5.2 逐项验证

| # | 检查 | 命令 | 判定 |
|---|------|------|------|
| 1 | 迁移日志无报错 | `docker compose -f docker-compose.hk.yml logs web \| grep -i migrat` | 无 error/conflict；对照第 4 节基线重跑行数查询，存量数据完好 |
| 2 | 3000 只绑回环 | `ss -tlnp \| grep 3000` | `127.0.0.1:3000`，**不是** `0.0.0.0:3000`（否则公网绕过 nginx 直达 web） |
| 3 | 443 本机可服务（源站自测） | `curl -sk https://127.0.0.1 -H 'Host: <域名>' -o /dev/null -w '%{http_code}'` | 返回 200 或 30x（`-k` 必须加：Origin CA 证书仅 CF 信任） |
| 4 | 公网域名已走 CF | 本机或服务器上 `dig +short <域名>` | 返回 Cloudflare 的 anycast IP（`104.x` / `172.67.x` 等），**不再是** `8.217.57.28`；若仍是源站 IP 说明 NS 未生效，等 1.1 第 4 步 |
| 5 | 公网 HTTPS（浏览器） | 浏览器开 `https://<域名>` | 落地页正常渲染，证书为 CF 边缘证书；再试 `http://<域名>` 应 301 到 https |
| 6 | **登录流程走通** | 注册/登录一个真实账号 | 登录后不被登出、跳转正常 |
| 7 | cron 端点可用 | `curl -fsS -X POST -H "Authorization: Bearer $(grep -E '^CRON_SECRET=' /opt/open-doing/.env \| cut -d= -f2-)" http://127.0.0.1:3000/api/cron/due-scan` | 成功响应；对应通知产生（如果今天确有到期任务）。注意 `cut -d= -f2-` 保留完整值——secret 末尾可能有 `=`，截掉会 401 |

## 6. crontab（每日 09:00 到期扫描）

```bash
sudo crontab -e
```

写入（`CRON_TZ` 行必须在 crontab 里——cronie 用它解释时间表，服务器若是 UTC 时区，不钉的话任务在 UTC 09:00 = 北京 17:00 才跑；`TZ` 行只是让作业进程里的 `date` 等也是北京时间）：

```cron
CRON_TZ=Asia/Shanghai
TZ=Asia/Shanghai
0 9 * * * curl -fsS -X POST -H "Authorization: Bearer $(grep -E '^CRON_SECRET=' /opt/open-doing/.env | cut -d= -f2-)" http://127.0.0.1:3000/api/cron/due-scan >> /var/log/od-due-scan.log 2>&1
```

**验证**：手动跑 5.2 第 7 项的 curl 成功 + crontab 里两行 TZ 变量存在。Debian 系 cron 与 vixie-cron（Alibaba Cloud Linux）对 `TZ=` 的支持有差异，`CRON_TZ` 是 cronie 的规范写法，两行都写保证兼容。

## 7. 日常更新

```bash
# 1. 本机：Actions 页手动触发 build-push-ghcr（构建并 push latest + git sha）
# 2. 服务器：
cd /opt/open-doing
docker compose -f docker-compose.hk.yml pull web
docker compose -f docker-compose.hk.yml up -d
```

- `latest` 永远指向最近一次成功构建；git sha tag 用于回滚：把 `.env` 不用改（镜像名写死 latest），回滚时临时把 compose 里的 tag 换成上一个正常工作的 sha 再 `pull web && up -d`，修好后再换回。
- 数据库迁移随容器启动自动执行（幂等）；跨版本升级前照例跑一遍第 4 节的基线对比。
