# 阿里云 ECS 部署实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 open-doing 部署到阿里云 ECS（docker compose：web + nginx，非标端口 8443，TLS，数据库 Supabase），镜像经 GitHub Actions 构建并 push 到阿里云 ACR。

**Architecture:** 新增一个生产编排文件 `docker-compose.aliyun.yml`（web + nginx 双服务，无 postgres）、一份 nginx 反代配置、一个手动触发的 GitHub Actions 构建流水线、一份 ECS 侧运维手册（Docker 安装 / acme.sh DNS-01 证书 / crontab / 迁移前检查）。仓库现有 `Dockerfile`、`docker-compose.prod.yml`、`docker/entrypoint.sh` 一律不动。

**Tech Stack:** docker compose、nginx、GitHub Actions（ubuntu-latest amd64）、阿里云 ACR 个人版、acme.sh（dns_ali 插件）、Supabase（session pooler）。

**Spec:** `docs/superpowers/specs/2026-11-12-aliyun-ecs-deployment-design.md`

## Global Constraints

- 对外端口仅 `8443/tcp`（https）；**任何配置不得依赖 80/443**（未备案域名，大陆 ECS 拦截）。
- ECS 为 x86 架构 2C2G；**构建只发生在 GitHub Actions runner 上**，ECS 与 Mac 都不做容器内编译。
- compose 里**不得出现 postgres 服务**；数据库唯一入口是 Supabase session pooler 连接串（形如 `postgres://postgres.<ref>:<pw>@aws-0-<region>.pooler.supabase.com:5432/postgres?sslmode=require`）。
- 现有 `docker-compose.prod.yml`、`Dockerfile`、`docker/entrypoint.sh` **不得修改**。
- 所有真实密钥（ACR 凭据、Supabase 连接串、`BETTER_AUTH_SECRET`、`CRON_SECRET`、阿里云 AccessKey）**不进 git、不进镜像**；GitHub 侧走 Secrets/Vars，ECS 侧走仓库根 `.env`。
- cjk-guard 只扫 `src/` 与 `e2e/`；本计划新增文件均在 `.github/`、`docker/`、`docs/`，中文注释允许。
- 本仓库 compose 变量缺失时用 `${VAR:?set VAR in .env}` 报错风格（与 `docker-compose.prod.yml` 一致）。

## Review Focus

1. `BETTER_AUTH_URL` 缺少 `:8443` 端口 → better-auth 推断的 base URL 缺端口，登录回跳全断。期望：`.env` 中显式 `https://<域名>:8443`。→ Task 4 运维手册验证清单里「登录流程走通」步骤钉住。
2. web 端口发布到 `0.0.0.0` → 绕过 nginx 直接暴露 3000。期望：只发布 `127.0.0.1:3000:3000`。→ Task 1 验证步骤用 `docker compose config` 断言。
3. crontab 未钉时区（ECS 默认 UTC）→ 提醒在凌晨 1 点触发而非 9 点。期望：crontab 头部 `TZ=Asia/Shanghai`。→ Task 4 运维手册钉住。
4. 迁移碰坏 Supabase 存量数据 → 期望：首启前先检查 `public` schema 存量对象，迁移只增量，冲突先报告。→ Task 4 运维手册「迁移前检查」章节钉住。
5. 证书续期后 nginx 未重载 → 证书过期全站报错。期望：acme.sh `--install-cert` 的 `reloadcmd` 用 `docker compose exec nginx nginx -s reload`。→ Task 4 运维手册续期章节钉住。

---

### Task 1: 生产编排文件 `docker-compose.aliyun.yml`

**Files:**
- Create: `docker-compose.aliyun.yml`
- Modify: `.env.example`（追加 aliyun 部署段落）

**Interfaces:**
- Consumes: 现有镜像（`docker/entrypoint.sh` 已内置迁移逻辑，无需改动）。
- Produces: 服务名 `web`（Task 2 的 nginx 反代目标 `http://web:3000`）、`nginx`；环境变量契约 `WEB_IMAGE` / `NGINX_IMAGE` / `DATABASE_URL` / `BETTER_AUTH_SECRET` / `CRON_SECRET` / `BETTER_AUTH_URL` / `CERT_DIR`（Task 3 与 Task 4 都按这套名字引用）。

- [ ] **Step 1: 写 `docker-compose.aliyun.yml`**

```yaml
name: open-doing-aliyun

# 阿里云 ECS 生产编排：未备案域名走非标端口 8443，数据库为 Supabase（session pooler），
# 故不含 postgres 服务。与 docker-compose.prod.yml（本机 web+postgres 场景）互不影响。
#
# 镜像由 GitHub Actions（.github/workflows/build-push-acr.yml）构建并 push 到阿里云 ACR，
# ECS 只 pull 运行。web 容器启动时先对 DATABASE_URL 执行幂等迁移（docker/entrypoint.sh）。
#
# 密钥与镜像地址从仓库根 .env 读取（compose 自动加载；不要提交真实值）：
#   WEB_IMAGE / NGINX_IMAGE  ACR 镜像地址（必填）
#   DATABASE_URL             Supabase session pooler 连接串（带 ?sslmode=require，必填）
#   BETTER_AUTH_SECRET / CRON_SECRET / BETTER_AUTH_URL   必填
#   CERT_DIR                 宿主机证书目录（acme.sh install-cert 目标，必填）

services:
  web:
    image: ${WEB_IMAGE:?set WEB_IMAGE in .env (ACR 镜像地址)}
    restart: unless-stopped
    # 只发布到回环地址：公网流量一律经 nginx，cron 从宿主机 127.0.0.1 触发
    ports:
      - "127.0.0.1:3000:3000"
    environment:
      DATABASE_URL: ${DATABASE_URL:?set DATABASE_URL in .env}
      BETTER_AUTH_SECRET: ${BETTER_AUTH_SECRET:?set BETTER_AUTH_SECRET in .env (openssl rand -base64 32)}
      CRON_SECRET: ${CRON_SECRET:?set CRON_SECRET in .env}
      # 非标端口必须显式设置，否则 better-auth 从请求推断的 base URL 缺端口
      BETTER_AUTH_URL: ${BETTER_AUTH_URL:?set BETTER_AUTH_URL in .env (https://<domain>:8443)}

  nginx:
    image: ${NGINX_IMAGE:?set NGINX_IMAGE in .env (ACR nginx 镜像地址)}
    restart: unless-stopped
    ports:
      - "8443:8443"
    volumes:
      - ./docker/nginx/aliyun.conf:/etc/nginx/conf.d/default.conf:ro
      - ${CERT_DIR:?set CERT_DIR in .env (acme.sh install-cert 目标目录)}:/etc/nginx/certs:ro
    depends_on:
      - web
```

- [ ] **Step 2: 在 `.env.example` 末尾追加 aliyun 部署段落**

```bash
# ---- 阿里云 ECS 部署（docker-compose.aliyun.yml）----
# compose 自动读取仓库根目录的 .env（不要提交真实值）：
#   WEB_IMAGE            ACR web 镜像地址（如 registry.cn-hangzhou.aliyuncs.com/<ns>/open-doing:latest）
#   NGINX_IMAGE          ACR nginx 镜像地址（如 registry.cn-hangzhou.aliyuncs.com/<ns>/open-doing-nginx:1.27-alpine）
#   DATABASE_URL         Supabase session pooler 连接串，必须带 ?sslmode=require
#   BETTER_AUTH_SECRET   会话签名密钥（openssl rand -base64 32）
#   CRON_SECRET          cron 路由鉴权密钥
#   BETTER_AUTH_URL      必须含非标端口，如 https://<域名>:8443
#   CERT_DIR             宿主机证书目录（acme.sh install-cert 目标，只读挂载进 nginx）
# web 只发布 127.0.0.1:3000（cron 从回环触发）；公网入口为 nginx 8443。
```

- [ ] **Step 3: 验证 compose 配置可渲染且约束成立**

先造一个假 env（真实密钥绝不进 shell 历史/仓库）：

```bash
cat > /tmp/od-aliyun-fake.env <<'EOF'
WEB_IMAGE=registry.cn-hangzhou.aliyuncs.com/ns/open-doing:latest
NGINX_IMAGE=registry.cn-hangzhou.aliyuncs.com/ns/open-doing-nginx:1.27-alpine
DATABASE_URL=postgres://postgres.ref:pw@aws-0-ap-southeast-1.pooler.supabase.com:5432/postgres?sslmode=require
BETTER_AUTH_SECRET=fake-secret
CRON_SECRET=fake-secret
BETTER_AUTH_URL=https://example.com:8443
CERT_DIR=/opt/open-doing/certs
EOF
docker compose -f docker-compose.aliyun.yml --env-file /tmp/od-aliyun-fake.env config > /tmp/od-aliyun-rendered.yml && echo OK
```

Expected: 输出 `OK`，且渲染结果满足以下约束（逐条确认）：

```bash
docker compose -f docker-compose.aliyun.yml --env-file /tmp/od-aliyun-fake.env config --services
# Expected 输出恰好两行: web、nginx（无 postgres）
grep -q "127.0.0.1:3000:3000" /tmp/od-aliyun-rendered.yml && echo loopback-ok   # web 只发布回环
grep -q "?sslmode=require" /tmp/od-aliyun-rendered.yml && echo sslmode-ok       # 连接串带 sslmode
```

再验证缺变量时会报错（防呆生效）：

```bash
docker compose -f docker-compose.aliyun.yml --env-file /dev/null config 2>&1 | head -2
```

Expected: 报错提示 `WEB_IMAGE` 未设置。

- [ ] **Step 4: Commit**

```bash
git add docker-compose.aliyun.yml .env.example
git commit -m "feat(deploy): add aliyun ecs compose with supabase and 8443 nginx entry"
```

---

### Task 2: nginx 反代配置

**Files:**
- Create: `docker/nginx/aliyun.conf`

**Interfaces:**
- Consumes: Task 1 的服务名 `web`（`proxy_pass http://web:3000`）与证书挂载点 `/etc/nginx/certs`。
- Produces: 容器内配置路径 `/etc/nginx/conf.d/default.conf`（Task 1 已挂载）、证书文件名约定 `fullchain.pem` / `privkey.pem`（Task 4 的 acme.sh `--install-cert` 按此安装）。

- [ ] **Step 1: 写 `docker/nginx/aliyun.conf`**

`<域名>` 占位符保留原样（实施部署时按运维手册替换，cjk-guard 不扫此目录所以中文占位可过；nginx 把它当普通 token 解析，`nginx -t` 可通过）：

```nginx
# open-doing 阿里云 ECS 反代：未备案域名仅监听 8443，不占用 80/443。
# 证书由宿主机 acme.sh（DNS-01，dns_ali）签发，SAN 覆盖裸域与 www 子域，
# install-cert 到宿主机 CERT_DIR（只读挂载为 /etc/nginx/certs）。
# <域名> 为占位符，部署时按 docs/deploy-aliyun-ecs.md 替换为真实域名。

server {
    listen 8443 ssl;
    server_name <域名> www.<域名>;

    ssl_certificate     /etc/nginx/certs/fullchain.pem;
    ssl_certificate_key /etc/nginx/certs/privkey.pem;

    client_max_body_size 10m;

    location / {
        proxy_pass http://web:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Proto https;
        proxy_set_header X-Forwarded-Port 8443;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }
}
```

- [ ] **Step 2: 用 nginx 容器验证配置语法**

```bash
docker run --rm -v "$PWD/docker/nginx/aliyun.conf:/etc/nginx/conf.d/default.conf:ro" nginx:1.27-alpine nginx -t
```

Expected: `syntax is ok` / `test is successful`（本机拉不动 Docker Hub 时改用 `docker.1ms.run/nginx:1.27-alpine`）。

- [ ] **Step 3: Commit**

```bash
git add docker/nginx/aliyun.conf
git commit -m "feat(deploy): add nginx 8443 tls reverse proxy config for aliyun ecs"
```

---

### Task 3: GitHub Actions 构建流水线

**Files:**
- Create: `.github/workflows/build-push-acr.yml`

**Interfaces:**
- Consumes: 仓库根 `Dockerfile`（原样构建）。
- Produces: ACR 镜像 `<ACR_REGISTRY>/<ACR_NAMESPACE>/open-doing:{latest,<git-sha>}` 与 `<ACR_REGISTRY>/<ACR_NAMESPACE>/open-doing-nginx:1.27-alpine`（Task 1 `.env` 里 `WEB_IMAGE` / `NGINX_IMAGE` 指向它们）；要求 GitHub 仓库配置 Vars `ACR_REGISTRY`、`ACR_NAMESPACE`，Secrets `ACR_USERNAME`、`ACR_PASSWORD`（Task 4 运维手册指引配置）。

- [ ] **Step 1: 写 `.github/workflows/build-push-acr.yml`**

```yaml
# 手动触发的 ACR 构建流水线：linux/amd64 runner 原生构建仓库根 Dockerfile，
# push 到阿里云 ACR 个人版；并镜像一份 nginx 基础镜像（ECS 不访问 Docker Hub）。
#
# 需在 GitHub 仓库配置：
#   Variables: ACR_REGISTRY（如 registry.cn-hangzhou.aliyuncs.com）、ACR_NAMESPACE
#   Secrets:   ACR_USERNAME / ACR_PASSWORD（ACR 个人版固定密码）
#
# ACR 仓库 open-doing 与 open-doing-nginx 需提前创建或开启自动创建（见运维手册）。

name: build-push-acr

on:
  workflow_dispatch:

env:
  WEB_IMAGE: ${{ vars.ACR_NAMESPACE }}/open-doing
  NGINX_IMAGE: ${{ vars.ACR_NAMESPACE }}/open-doing-nginx
  NGINX_SRC: nginx:1.27-alpine

jobs:
  web:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: docker/setup-buildx-action@v3
      - uses: docker/login-action@v3
        with:
          registry: ${{ vars.ACR_REGISTRY }}
          username: ${{ secrets.ACR_USERNAME }}
          password: ${{ secrets.ACR_PASSWORD }}
      - uses: docker/build-push-action@v6
        with:
          context: .
          push: true
          tags: |
            ${{ vars.ACR_REGISTRY }}/${{ env.WEB_IMAGE }}:latest
            ${{ vars.ACR_REGISTRY }}/${{ env.WEB_IMAGE }}:${{ github.sha }}
          cache-from: type=gha
          cache-to: type=gha,mode=max

  nginx:
    runs-on: ubuntu-latest
    steps:
      - uses: docker/login-action@v3
        with:
          registry: ${{ vars.ACR_REGISTRY }}
          username: ${{ secrets.ACR_USERNAME }}
          password: ${{ secrets.ACR_PASSWORD }}
      - name: Mirror nginx base image to ACR
        run: |
          docker pull "$NGINX_SRC"
          docker tag "$NGINX_SRC" "${{ vars.ACR_REGISTRY }}/${NGINX_IMAGE}:1.27-alpine"
          docker push "${{ vars.ACR_REGISTRY }}/${NGINX_IMAGE}:1.27-alpine"
```

- [ ] **Step 2: 验证 YAML 可解析**

```bash
python3 -c "import yaml,sys; yaml.safe_load(open('.github/workflows/build-push-acr.yml')); print('OK')"
```

Expected: 输出 `OK`。

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/build-push-acr.yml
git commit -m "ci: add manual acr build workflow for amd64 image delivery"
```

---

### Task 4: ECS 运维手册（含迁移前检查与验证清单）

**Files:**
- Create: `docs/deploy-aliyun-ecs.md`

**Interfaces:**
- Consumes: Task 1 的 compose 文件与变量契约、Task 2 的 nginx 配置与证书文件名、Task 3 的 workflow 与 GitHub 配置项。
- Produces: 用户在 ECS/阿里云控制台执行的完整步骤与验证清单（纯文档，无代码接口）。

- [ ] **Step 1: 写 `docs/deploy-aliyun-ecs.md`**

文档为中文，按以下章节组织，每节给出可直接复制的命令（ECS 侧命令假设部署目录 `/opt/open-doing`）：

1. **前置准备**：
   - 阿里云 DNS：给裸域与 `www` 各加一条 A 记录指向 ECS 公网 IP（备案通过前 80/443 不可用，与端口无关）；
   - 安全组：入方向放行 `8443/tcp`（来源限制为 `0.0.0.0/0`）；
   - ACR 个人版：开通、创建命名空间、创建仓库 `open-doing` 与 `open-doing-nginx`（或开启自动创建）、设置固定密码；
   - GitHub 仓库：配置 Vars `ACR_REGISTRY`（与 ECS 同地域，如 `registry.cn-hangzhou.aliyuncs.com`）、`ACR_NAMESPACE`；Secrets `ACR_USERNAME`、`ACR_PASSWORD`；手动触发 `build-push-acr` workflow，确认 ACR 里出现两个镜像。
2. **ECS 初始化**：
   - 安装 Docker + compose 插件（阿里云软件源 `mirrors.aliyun.com/docker-ce`，给出命令）；
   - 部署文件：`scp docker-compose.aliyun.yml docker/nginx/aliyun.conf docs/` 所需文件到 `/opt/open-doing`（或 `git clone` 后按需软链），**nginx 配置里的 `<域名>` 占位符必须替换为真实域名**；
   - 创建 `/opt/open-doing/.env`（变量契约见 `.env.example` 的 aliyun 段落；`openssl rand -base64 32` 生成两个 secret；`CERT_DIR=/opt/open-doing/certs`）。
3. **TLS 证书（acme.sh，DNS-01）**：
   - RAM 子账号：只授予 `AliyunDNSFullAccess`，生成 AccessKey；
   - `curl https://get.acme.sh | sh -m <email>`（大陆网络失败时备选：从 Mac `git clone` acme.sh 后 scp 上去）；
   - `export Ali_Key=... Ali_Secret=...` 后
     `~/.acme.sh/acme.sh --issue --dns dns_ali -d <域名> -d www.<域名>`；
   - `~/.acme.sh/acme.sh --install-cert -d <域名> --fullchain-file /opt/open-doing/certs/fullchain.pem --key-file /opt/open-doing/certs/privkey.pem --reloadcmd "docker compose -f /opt/open-doing/docker-compose.aliyun.yml exec nginx nginx -s reload"`（续期钩子即靠这条 reloadcmd，Review Focus 第 5 条）；
   - `--install-cert` 在 nginx 容器尚未启动时会报 reload 失败，属预期——先装证书再 `up`，首次 `up` 后手动执行一次 reload 确认钩子路径可用。
4. **数据库迁移前检查（存量数据保护，Review Focus 第 4 条）**：
   - 在 Supabase Dashboard SQL Editor 或本机 psql 对 `DATABASE_URL` 执行检查查询，记录 `public` schema 现有表与行数（给出查询：`select table_name from information_schema.tables where table_schema='public';` 及逐表 `select count(*)`）；
   - 规则写死在文档里：web 容器首启会跑幂等迁移（entrypoint），**迁移只做增量 DDL；如遇对象冲突报错，停下来报告，禁止 drop/truncate 或改迁移文件绕过**；
   - 首启后核对迁移日志：`docker compose -f /opt/open-doing/docker-compose.aliyun.yml logs web | grep -i migrat`，并重新执行第 4 步的行数查询确认存量数据完好。
5. **启动与验证清单**：
   - `docker compose -f /opt/open-doing/docker-compose.aliyun.yml up -d`；
   - 逐项验证（每项给出判定标准）：`curl -sk https://127.0.0.1:8443 -H 'Host: <域名>' -o /dev/null -w '%{http_code}'` 返回 30x/200；浏览器访问 `https://<域名>:8443` 出现落地页；注册/登录流程走通（Review Focus 第 1 条）；`docker compose exec ... ` 不适用——在宿主机 `curl -fsS -X POST -H "Authorization: Bearer <CRON_SECRET>" http://127.0.0.1:3000/api/cron/due-scan` 返回成功（Review Focus 第 2 条：确认 `ss -tlnp | grep 3000` 只绑在 `127.0.0.1`）。
6. **crontab（Review Focus 第 3 条）**：
   - `sudo crontab -e` 写入头部 `TZ=Asia/Shanghai`（Debian cron 支持 TZ 变量；写完后用 `grep TZ /etc/crontab` 与 `date` 对照确认服务器时区语境）与
     `0 9 * * * curl -fsS -X POST -H "Authorization: Bearer $(grep -E '^CRON_SECRET=' /opt/open-doing/.env | cut -d= -f2)" http://127.0.0.1:3000/api/cron/due-scan >> /var/log/od-due-scan.log 2>&1`；
   - 手动跑一次 curl 验证通知确实产生。
7. **日常更新流程**：GitHub Actions 手动触发 → ECS `docker compose pull web && docker compose up -d`；说明 `latest` 与 git sha 双 tag 的对应关系。

- [ ] **Step 2: 对照验证清单自查**

通读文档，逐条确认 Review Focus 五项都在文档中有对应步骤且判定标准明确；确认所有命令中的真实密钥均为占位符（文档里不出现任何真实凭据）。

- [ ] **Step 3: Commit**

```bash
git add docs/deploy-aliyun-ecs.md
git commit -m "docs: add aliyun ecs deployment runbook"
```

---

## Self-Review 记录

- **Spec coverage**：spec「已决定的事项」1→Task 1/2（8443）、2→Task 3（ACR/Actions）、3→Task 1（compose 双服务）、4→Task 2/4（证书）、5→Task 1（env 契约）、6→Task 4（cron）、7→Task 4（迁移前检查）、8→Task 2/4（域名占位替换）；「留给实施者」各项均有落点。无缺口。
- **Step scan**：每步只写一个可判定的东西；配置文件全文给出（值即设计），文档任务给章节结构与关键命令而非成稿。
- **Type consistency**：服务名 `web`/`nginx`、变量名 `WEB_IMAGE`/`NGINX_IMAGE`/`CERT_DIR`、证书文件名 `fullchain.pem`/`privkey.pem`、ACR 仓库名 `open-doing`/`open-doing-nginx` 在四个任务间一致。
- **Review Focus**：五项均已在对应任务钉住（见各行标注）。
- **Proportion**：配置文件全文属「spec 固定了精确值」的正当范围；其余以签名/命令/判据表达。
