# AGENTS.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目概述

Open Doing:个人 + 团队任务与项目管理系统(v1.1)。单体 Next.js 16(App Router,React 19,Turbopack)+ PostgreSQL 17 + Drizzle ORM + antd v6 + Tailwind CSS 4。全站中文(`zh_CN` locale),页面默认 RSC,写操作走 Server Actions。登录后按空间组织:个人空间与各团队空间共用 Dashboard / Kanban / Calendar / Analysis / 设置五模块导航,路由统一为 `/space/{spaceRef}/{module}`(`spaceRef` = `personal` 或团队 slug)。

权威文档(改代码前先读对应部分):
- `docs/2026-10-21-open-doing-v1-design.md` — 产品"是什么、为什么"
- `docs/ARCHITECTURE.md` — "怎么搭"
- `docs/prototypes/` — HTML 原型,是 UI 视觉与文案的对照基准(本轮冻结,不随实现改动)
- `docs/V1_TASKS.md` — 任务板;代码注释中的 F-5 / P-5 / N-2 等编号指向此文件,其中冻结契约(如 `AppShell`、`(dashboard)/layout.tsx` 的导入关系)不得修改
- `docs/V1.1_TASKS.md` — v1.1 任务板与各模块「实现记录」,S/M/X 编号指向此文件

`apps/web/AGENTS.md`:Next.js 16 相对训练数据有破坏性变更,写 Next 相关代码前先读 `apps/web/node_modules/next/dist/docs/` 中的相关指南,留意废弃通告。

## 常用命令(仓库根目录)

```bash
docker compose up -d --wait   # 启动 PostgreSQL(开发库 open_doing + 测试库 open_doing_test + e2e 库 open_doing_e2e)
pnpm install
cp .env.example apps/web/.env.local   # Next.js 从 apps/web 解析 env,不是仓库根
pnpm dev                      # web 应用,http://localhost:3000
pnpm build
pnpm lint                     # 所有包
pnpm typecheck                # 见下方顺序要求
pnpm test                     # 全部 Vitest 用例
pnpm vitest run apps/web/src/lib/slug.test.ts   # 单个测试文件
pnpm db:generate              # 改 schema.ts 后生成迁移
pnpm db:migrate
pnpm db:seed                  # 幂等示例数据(用户 林夏/doing_x7k2m9,密码 seed-password)
pnpm --filter @open-doing/web test:e2e          # Playwright e2e(端口 3100,独立库 open_doing_e2e)
pnpm --filter @open-doing/web test:e2e -- flows/04-cron-reminder.spec.ts   # 单条 e2e 流
```

环境变量陷阱:
- **vitest 和 drizzle-kit 不读取 `apps/web/.env.local`**,先 `set -a; source apps/web/.env.local; set +a` 再跑测试/迁移,否则数据库用例静默跳过。
- `TEST_DATABASE_URL` 指向的库会被测试**清空**;必须与开发库 `DATABASE_URL` 指向不同的库。
- 类型检查顺序:干净 checkout 上先 `pnpm build`(或 `pnpm --filter @open-doing/web exec next typegen`)再 `pnpm typecheck`——Next 16 的路由类型由构建生成。
- 首次跑 e2e 前:`pnpm --filter @open-doing/web exec playwright install chromium`。

## 架构

### Monorepo(pnpm workspaces)

- `apps/web`(`@open-doing/web`)— 唯一应用:页面 + Server Actions + Route Handler + DB 访问。
- `packages/types`(`@open-doing/types`)— 前后端共享的**可序列化类型与纯函数**(如 `getTaskProgress`、`isOverdue`)。规则:不依赖 React、不访问数据库、不做 IO。Drizzle 行类型留在 web 包内,跨边界时在 features 层映射为领域模型。

### features 领域模块(`apps/web/src/features/`)

按领域自包含:auth / users / teams / projects / tasks / kanban / calendar / analysis / notifications / personal / dashboard。每个领域:
- `actions.ts` — Server Actions:入参校验 → 权限校验 → 调 service → 返回 `ActionResult<T>`(`{ ok: true, data }` 或 `{ ok: false, errors: { form?, <field>?: string } }`)。字段错误由客户端表单映射回对应 `Form.Item`。
- `service.ts` — 数据访问与业务规则(如"member 不能改他人任务"),不散落在页面里。
- `components/` — 领域组件;跨领域通用件放 `src/components/ui`。

### 服务端/客户端边界

- 页面默认 RSC:服务端按会话用户取数,不经过公开 API;`(dashboard)` 路由由 `requireUser()` 统一重定向到 `/login`。
- antd 交互组件(Modal、message、Dropdown 等)只能在 `"use client"` 组件中使用;页面把交互下沉为 client 包装件,通过 props 传可序列化数据。乐观更新的组件用"渲染期同步 props → state"模式(`if (props !== synced) { ... }`)对接 `router.refresh()`。

### 权限模型(必须遵守)

- **每个 Server Action 独立鉴权**,不信任页面隐藏了入口;权限判定集中在 `features/teams`(`canEditTask({ role, actorId, assigneeId })` 等)与各 feature service。
- 数据查询带可见性过滤:团队数据要求成员资格;个人空间数据(个人任务/个人项目)只有本人可见。
- 评论权限与内容编辑权限分开;成员可评论、可看详情,但不能改他人任务。

### UI 层约定

- 组件以 antd v6 为准,不自己造;Tailwind 只做布局/间距/微调。`globals.css` **关闭了 preflight**(只引 theme + utilities,手工保留 box-sizing)——不要加回样式重置,不要用全局选择器覆盖 antd 内部样式。
- 主题唯一入口 `apps/web/src/app/theme.ts`(antd ThemeConfig);根布局 `providers.tsx` 用 `AntdRegistry` + `ConfigProvider locale={zhCN}` 包裹,**不得再自建 ConfigProvider**。
- 设计令牌源自 `docs/prototypes/assets/design-tokens.css`(品牌紫 `#7d2ae8`、渐变 `#7d2ae8→#00c4cc`);运行时副本是 `apps/web/src/app/tokens.css`(由 `globals.css` 引入),变量名与取值须与原型保持 1:1,改令牌时两处同步。新 UI 对照 `docs/prototypes/` 同名页面实现。

### 国际化(i18n,v1.1 起强制)

- 全站文案走 next-intl(无 URL locale 前缀):消息包在 `apps/web/src/i18n/messages/{zh,en}.json`,请求级 locale 解析见 `apps/web/src/i18n/server.ts`。
- **所有用户可见文案必须进消息包,禁止硬编码**:`src/i18n/cjk-guard.test.ts` 强制扫描 `src` 与 `e2e`(剥注释后含 CJK 即失败并列出 file:line);非文案中文需在测试内白名单逐条给理由。
- **新功能(组件/表单/错误/通知)交付时必须同时提供 zh 与 en 条目**:`src/i18n/messages-parity.test.ts` 强制两包 key 结构一致。
- 服务端错误文案:service 层 `throw new <X>Error(zh 兜底, field, { key, params })`,action 层的 `toFailure` 经 `standardFailuresForRequest()`(内部按请求 locale 取 translator)用 `failures.custom("<领域ns>.<key>", params)` 翻译到 `field ?? "form"`(`lib/domain-failure.ts` 提供可注入 translator 的纯函数变体 `domainFailureWith`)。领域错误 key 放对应领域命名空间,通用失败(403/限流等)放 `errors` 命名空间。构造参数里的中文只是兜底,不得直接展示。
- 通知模板正文带 `<b>` 粗体标记,由 `features/notifications/components/notification-format.ts` 的 `parseBoldSegments` 解析为分段渲染;改模板时 zh/en 同步。
- 语言偏好:登录态以 `users.language` 为唯一权威(多设备切换即时生效),未登录读 cookie `od_locale`,皆无回落 zh;切换入口只在个人设置页(`users/actions.ts` 的 `updateLanguageAction` 同时写 DB 与 cookie)。
- antd / dayjs locale 与 `html lang` 由根 Providers 与根布局按请求 locale 统一切换(`LOCALE_HTML_LANG`);语言切换的成功 toast 等 client 侧文案在 RSC refresh 送达新消息包后再渲染。

### 日期口径

「今天」统一按 Asia/Shanghai 计算(`apps/web/src/lib/today.ts` 与通知 cron 同口径)。RSC 把 `today` 作为 prop 传给 client 组件做逾期/临期判定,保证服务端/客户端渲染一致;不要在组件里用本地时区取当前日期。`due_date` 是 Postgres `date` 类型。

### 数据库

- Schema:`apps/web/src/server/db/schema.ts`;迁移 `apps/web/drizzle/`(可在空库重放)。slug 定位团队/项目,任务详情用不透明 ID。
- 级联删除靠外键 `ON DELETE CASCADE` 兜底;移除成员只删 membership 并把任务的 `assignee_id` 置空,不删任务。
- `server/db/testing.ts` 负责重放迁移 + 清测试库。

### 测试约定

- Vitest 在仓库根配置,**测试文件串行执行**(`fileParallelism: false`)——多个文件共用同一个测试库且会互相 TRUNCATE,不要开启并行。
- 通知由领域动作在同一事务内同步产生;临期/逾期通知由 `POST /api/cron/due-scan`(`CRON_SECRET` 鉴权)产生,幂等设计。
