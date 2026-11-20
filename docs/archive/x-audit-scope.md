# Track X v1 范围复核（X-6）

日期：2026-10-25
代码：`asher/m33` @ `b1050f4`（范围复核前的 HEAD；本文档与任务板回写另行提交）
依据：设计文档 §1「非目标」（`docs/2026-10-21-open-doing-v1-design.md:21-29`）、§12 实现边界
（`docs/2026-10-21-open-doing-v1-design.md:239-250`）、任务板 X-6（`docs/V1_TASKS.md:492`）。

## 1. 方法与判据

- 复核对象是**已交付的运行时功能**：`apps/web/src`、`packages/types/src`、`apps/web/package.json`、
  `pnpm-lock.yaml`。`docs/prototypes/` 是设计稿，不是运行时功能，不计入越界。
- 每条非目标用可复现的 grep / 文件读取取证；grep **无输出（exit 1）**即表示代码中不存在该能力。
- 判定标准：不存在用户可见的越界入口（路由 / 表单 / 接口 / 依赖）即「无越界」。
  仅出现在实现注释、演示数据标题或营销文案中的词不构成功能。
- 未发现需要删除的代码；无需 BLOCKED。

## 2. X-6 明列四项

### 2.1 无邮箱 / 邮件

| 检查 | 命令 / 文件 | 结果 |
|---|---|---|
| 源码无邮件字段或发送代码 | `grep -rn -i -E "\bemail\b\|\bmail\b\|nodemailer\|sendgrid\|postmark" apps/web/src packages/types/src --include="*.ts" --include="*.tsx"` | 无输出（exit 1） |
| 无邮件依赖 | `grep -n -i -E "nodemailer\|sendgrid\|resend\|postmark\|smtp\|mailgun" apps/web/package.json` | 无输出（exit 1） |
| 锁文件无邮件包 | `grep -n "nodemailer\|sendgrid\|resend\|postmark" pnpm-lock.yaml` | 无输出；仅 drizzle-orm 的可选 peer 元数据出现 `@aws-sdk/client-rds-data`（`pnpm-lock.yaml:2102`、`:2133` → `peerDependenciesMeta.optional: true`），包未安装、无代码引用，与邮件无关 |
| users 表无 email 列 | `apps/web/src/server/db/schema.ts:30-36` | 仅 `id / uid / username / password_hash / created_at` |
| 注册只收用户名 + 密码 | `features/auth/components/RegisterForm.tsx:15-19`（`username / password / confirmPassword`）、`features/auth/service.ts:60-63`（`AuthInput`） | 服务端入参只有用户名、密码；`confirmPassword` 仅前端校验 |
| 用户类型无邮箱 | `packages/types/src/index.ts:26-33` | 注释明确「仅用户名 + 密码登录，不收集邮箱」 |
| 通知只做系统内 | `apps/web/src/server/db/schema.ts:179-199`（notifications 表）、`packages/types/src/index.ts:18-24`（六种类型） | 无任何外发通道 |

结论：**符合**。注册、会话、通知均在站内完成。

### 2.2 无密码找回

| 检查 | 命令 / 文件 | 结果 |
|---|---|---|
| 无找回密码路由 | `find apps/web/src/app -type d \| grep -i -E "forgot\|reset\|password"`；`find apps/web/src/app -name page.tsx` | auth 段只有 `/login`、`/register`；无 forgot/reset 目录 |
| 无找回密码动作 / 服务 | `features/auth/actions.ts:33/43/53`、`features/auth/service.ts:126/174/197` | 仅 `registerAction/loginAction/logoutAction`、`registerUser/login/logout` |
| 关键词 grep | `grep -rn -i -E "forgot\|reset.?password\|password.?reset\|忘记密码\|找回密码\|重置密码" apps/web/src packages/types/src` | 唯一命中 `features/auth/components/LoginForm.tsx:120` 的说明文案「v1 暂不支持找回密码」 |

结论：**符合**。无找回入口，且登录页明确告知 v1 不支持。

### 2.3 无实时推送

| 检查 | 命令 / 文件 | 结果 |
|---|---|---|
| 无 WebSocket / SSE 代码或依赖 | `grep -rn -i -E "websocket\|socket\.io\|event-?source\|server-sent\|\bsse\b\|pusher\|ably\|firebase" apps/web/src packages/types/src apps/web/package.json pnpm-lock.yaml` | 无输出（exit 1） |
| 通知获取方式是轮询 | `features/notifications/components/NotificationBell.tsx:29`（`POLL_INTERVAL_MS = 30_000`）、`:239`（`setInterval(poll, POLL_INTERVAL_MS)`）；读接口 `app/api/notifications/route.ts:37` 为普通 `GET` | 客户端定时轮询，服务端无长连接 |
| 设计是否允许轮询 | `docs/2026-10-21-open-doing-v1-design.md:230`：通知的获取方式（轮询或实时）由实现确定 | 轮询是设计允许的实现选择 |

观察（非越界，不改代码）：登录/注册页品牌区文案含「团队项目进度实时同步」
（`apps/web/src/app/(auth)/layout.tsx:51`）。这是产品文案；实际同步机制是服务端渲染 + 用户操作后的
`router.refresh()` + 通知 30s 轮询，不存在推送通道。记录为措辞观察，不构成越界功能。

结论：**符合**。

### 2.4 无文件上传——头像用用户名首字母

| 检查 | 命令 / 文件 | 结果 |
|---|---|---|
| 无上传表单 / 解析库 / 存储 SDK | `grep -rn -i -E "type=[\"']file[\"']\|multipart/form-data\|multer\|formidable\|busboy\|uploadthing\|file\.arrayBuffer\|createReadStream\|@aws-sdk/client-s3" apps/web/src packages/types/src apps/web/package.json` | 无输出（exit 1） |
| 头像取用户名首字 | `apps/web/src/components/ui/UserAvatar.tsx:40`：`Array.from(username.trim())[0] ?? "?"`；`:34-38` 注释「用户名首字 + 由用户名哈希决定的点缀色圆形背景」 | 纯展示组件，无上传入口；全仓 21 处使用 |
| 设计口径 | `docs/2026-10-21-open-doing-v1-design.md:249`：「头像：用用户名首字母生成，不做文件上传」 | 一致 |

结论：**符合**。

## 3. 设计文档 §1 其余非目标

| 非目标（设计 `:21-29`） | 取证 | 结论 |
|---|---|---|
| 任务优先级、标签 | `tasks` 表字段见 `server/db/schema.ts:128-152`：无 `priority` / `tag` 列。`grep -i -E "\bpriority\b\|优先级"` 仅命中健康度判定注释（`features/dashboard/team-overview/constants.ts:35`，指「逾期 > 临期 > 正常」的判定顺序）；`grep -i -E "\btagId\b\|\btags\b\|标签"` 仅命中状态标签组件/设置页注释与 seed 任务标题（`server/db/seed.ts:405`） | 符合 |
| 任务/项目的操作动态流水 | `schema.ts` 共 9 张 `pgTable`（users/teams/teamMemberships/teamInvites/projects/tasks/subtasks/comments/notifications，`:30-199`），无 activity / audit 表；`grep -rn -i -E "activity\|audit.?log\|操作动态"` 无输出（exit 1）；`/invites` 的「历史记录」是邀请响应历史（T-3），不是任务/项目动态流 | 符合 |
| 第三方登录（GitHub/Google 等） | `grep -rn -i -E "oauth\|passport\|third.?party\|第三方登录" apps/web/src packages/types/src apps/web/package.json` 无输出（exit 1）；认证只有用户名 + 密码 | 符合 |
| 催办、审批等管理动作 | `grep -rn -i -E "approval\|审批\|催办\|nudge"` 仅两处注释，说明概览页只读、无催办/改派按钮（`app/(dashboard)/teams/[teamSlug]/page.tsx:54`、`features/dashboard/team-overview/components/MemberLoadList.tsx:63`）；无对应服务/动作实现 | 符合 |
| 邮件通知 | 见 §2.1 | 符合 |
| 收集邮箱 | 见 §2.1 | 符合 |
| 密码找回 | 见 §2.2 | 符合 |

## 4. 结论

X-6 明列的四项（无邮箱/邮件、无密码找回、无实时推送、无文件上传）与设计文档 §1 的七条非目标
**全部无越界实现**；未发现需要删除的代码。唯一记录项是登录页「实时同步」营销措辞（§2.3），
属文案而非功能，按「只记录、不改代码」处理。

## 5. 复核命令与输出摘要

```text
$ grep -rn -i -E "\bemail\b|\bmail\b|nodemailer|sendgrid|postmark" \
    apps/web/src packages/types/src --include="*.ts" --include="*.tsx"
# 无输出，exit 1

$ grep -n -i -E "nodemailer|sendgrid|resend|postmark|smtp|mailgun" apps/web/package.json
# 无输出，exit 1

$ grep -rn -i -E "forgot|reset.?password|password.?reset|忘记密码|找回密码|重置密码" \
    apps/web/src packages/types/src
apps/web/src/features/auth/components/LoginForm.tsx:120: ... v1 暂不支持找回密码 ...

$ grep -rn -i -E "websocket|socket\.io|event-?source|server-sent|\bsse\b|pusher|ably|firebase" \
    apps/web/src packages/types/src apps/web/package.json pnpm-lock.yaml
# 无输出，exit 1

$ grep -rn -i -E "type=[\"']file[\"']|multipart/form-data|multer|formidable|busboy|uploadthing|file\.arrayBuffer|createReadStream|@aws-sdk/client-s3" \
    apps/web/src packages/types/src apps/web/package.json
# 无输出，exit 1

$ grep -rn -i -E "oauth|passport|third.?party|第三方登录" \
    apps/web/src packages/types/src apps/web/package.json
# 无输出，exit 1

$ grep -rn -i -E "activity|audit.?log|操作动态" apps/web/src packages/types/src
# 无输出，exit 1
```
