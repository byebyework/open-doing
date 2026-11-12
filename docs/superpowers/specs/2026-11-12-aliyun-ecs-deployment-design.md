# 阿里云 ECS 部署设计（docker compose + Supabase + 未备案域名）

日期：2026-11-12
状态：待确认

## 意图与背景

把 open-doing（单体 Next.js + PostgreSQL + Drizzle）部署到一台阿里云 ECS（2 核 2G，中国大陆地域），通过 docker compose 运行，用自有域名访问。域名**未做 ICP 备案**；数据库不落在 ECS 上，而是使用已有的 **Supabase** 项目（亚洲区节点）。

目标形态：

```
浏览器 ── https://<域名>:8443 ──▶ ECS
                                   ├─ nginx（容器，TLS 终结 + 反代）
                                   └─ web（Next.js 容器）
                                        │ TLS（跨境）
                                        ▼
                                   Supabase pooler（session mode）
```

## 目标

- 用户能通过 `https://<域名>:8443` 正常访问完整应用（登录、看板、日历、分析等）。
- TLS 证书自动申请与续期，全程不占用 80/443 端口。
- 首次部署时数据库 schema 自动迁移到 Supabase（复用现有容器 entrypoint 的幂等迁移），且**不触碰库中已有数据**。
- 到期提醒扫描（`POST /api/cron/due-scan`）每天北京时间 09:00 执行。
- 现有 `docker-compose.prod.yml`（本机 web + postgres 场景）**原样保留**，本机启动需求不受影响。

## 非目标

- 不做 ICP 备案。将来若备案通过，只需 nginx 加一个 443 监听，其余零改造——本设计不实现它。
- 不做自动化发布：GitHub Actions 只负责构建并 push 镜像（手动触发），ECS 上的 pull 与 `docker compose up -d` 仍是手动操作。
- 不动 `edgeone.json`（另一条部署路线的遗留配置）。

## 反目标（出现即算失败）

- 任何对 80/443 端口的依赖——大陆 ECS + 未备案域名必然不通。
- 在 ECS 上执行容器内编译——2C2G 有 OOM 风险，构建只发生在 GitHub Actions 的 amd64 runner 上。
- 使用 Supabase **transaction pooler**——prepared statements 会失效；必须用 session mode。

## 约束

- ECS：已购，2C2G，**x86 架构**，中国大陆地域。Docker Hub 直连不可靠。但 ECS 只从 ACR 拉最终镜像，不接触 Docker Hub。开发 Mac 为 Apple Silicon（arm64）且无 buildx，**本机构建无法产出 amd64 镜像**。
- 构建/发布链路改走 **GitHub Actions**（手动触发的极简 workflow，linux/amd64 原生 runner）：构建仓库现有 `Dockerfile`（`NEXT_SKIP_TYPECHECK=1` 路径），push 到阿里云 ACR 个人版。ACR 凭据以 GitHub Secrets 注入，不落仓库。
- Supabase：直连地址（5432）仅 IPv6，阿里云 ECS 默认无 IPv6，因此必须走 **Supavisor pooler**。连接串形如：
  `postgres://postgres.<project-ref>:<password>@aws-0-<region>.pooler.supabase.com:5432/postgres?sslmode=require`
  应用客户端为 postgres.js（`apps/web/src/server/db/client.ts`），原生支持 URL 内 `sslmode`，session mode 下 prepared statements 可用——无需改代码。
- 域名 DNS 托管在阿里云：acme.sh 用 `dns_ali` 插件做 DNS-01 验证，需要一把 RAM 子账号 AccessKey（建议仅授予 DNS 写权限，如 `AliyunDNSFullAccess`，密钥不入库不入镜像）。
- 安全组：仅放行入方向 `8443/tcp`（及 `22/tcp` SSH）。

## 已决定的事项

1. **端口策略**：对外 `8443`（https）。备案后加 443 监听即可。
2. **构建与分发**：手动触发的 GitHub Actions workflow（`workflow_dispatch`），在 linux/amd64 runner 上构建仓库现有 `Dockerfile`，push 到**阿里云 ACR 个人版**（ACR 与 ECS 同地域，实施时确认地域）。镜像 tag 用 `latest` + git sha 双 tag。ECS `docker login` 后 pull，同 region 可用 ACR 的 VPC 内网 endpoint（`registry-vpc.<region>.aliyuncs.com`），免流量费且快。
3. **compose 文件**：新增 `docker-compose.aliyun.yml`，只含两个服务：
   - `web`：复用现有镜像与 entrypoint（启动时对 `DATABASE_URL` 执行幂等迁移），环境变量来自 `.env`；
   - `nginx`：挂载 nginx 配置与 TLS 证书目录，监听 `8443 ssl`，`proxy_pass http://web:3000`，透传 `X-Forwarded-Proto`/`X-Forwarded-For`，`client_max_body_size` 按表单上传需要放宽。
   - **不含 postgres 服务**——数据库是 Supabase。
4. **TLS 证书**：宿主机装 acme.sh，DNS-01（`dns_ali`）签发，**SAN 同时覆盖裸域与 `www` 子域**（决定权在我），`fullchain.pem`/`key.pem` 目录挂载进 nginx 容器；acme.sh 自带续期 cronjob，续期后执行 `docker exec <nginx容器> nginx -s reload` 平滑生效。RAM 子账号 AccessKey（仅 DNS 权限）由用户提供，不入库不入镜像。
5. **环境变量**（ECS 上仓库根 `.env`，不入库；Supabase pooler 连接串与各密钥在实施阶段由用户提供，只经带外渠道交接）：
   - `DATABASE_URL` — Supabase session pooler 连接串（带 `?sslmode=require`）；
   - `BETTER_AUTH_SECRET` — `openssl rand -base64 32`；
   - `CRON_SECRET` — 同上；
   - `BETTER_AUTH_URL` — `https://<域名>:8443`（非标端口必须显式设置，否则 better-auth 从请求推断出的 base URL 可能缺端口）。
6. **cron**：宿主机 crontab 每日触发到期扫描（`curl -X POST -H "Authorization: Bearer $CRON_SECRET" http://127.0.0.1:3000/api/cron/due-scan`），不走公网。**时间定为北京时间 09:00，crontab 钉死 `CRON_TZ=Asia/Shanghai`**（用户已确认；ECS 默认 UTC 时区，必须显式钉住）。web 的 3000 端口只在回环地址发布（`127.0.0.1:3000:3000`），不对公网暴露。
7. **迁移**：单副本部署，由 web 容器 entrypoint 直连 Supabase 执行，不设 `SKIP_DB_MIGRATION`。**Supabase 库中有存量数据需要保留（用户已确认）**：首次迁移前必须先检查 `public` schema 现状（已有对象、表、数据归属），迁移全程只用增量 DDL，不做任何 drop/truncate；若现有对象与迁移冲突，先向用户报告再动手，不许静默绕过。
8. **域名**：文档与配置中以 `<域名>` 占位，实施时替换为真实域名。

## 留给实施者

- 编写 `docker-compose.aliyun.yml`、nginx 配置文件、GitHub Actions workflow、acme.sh 安装与续期钩子的具体落地。
- ACR 命名空间/仓库名（与 ECS 同地域）、ECS 上 Docker 的安装（用阿里云软件源）。
- 实施前确认项：ECS 具体地域、域名占位符替换、Supabase `public` schema 现状检查。
- 首次部署后的验证清单：DNS 解析生效、证书签发成功、web 容器迁移日志无报错（存量数据完好）、登录流程走通、cron 手动触发一次成功。

## 审查者核查结论（已采纳）

构建审查（builder check）提出的问题及处理：

- **amd64 镜像产出**：Mac 为 arm64 且无 buildx，本机构建不可行 → 改为 GitHub Actions 手动触发构建（用户已确认）。
- **ECS 架构/地域**：已购 x86（用户已确认）；地域待实施时确认（ACR 需同地域）。
- **Supabase 存量数据**：需要保留（用户已确认）→ 迁移前检查 + 只增量不动已有数据的硬性要求，见「已决定的事项」第 7 条。
- **cron 时间**：北京时间 09:00，钉死时区（用户已确认）。
- **证书范围**：裸域 + www 双 SAN（我的决定）。
- **密钥交接**：pooler 连接串、各 secret、阿里云 AccessKey 均在实施阶段经带外渠道提供，不入库。
