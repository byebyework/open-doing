# 轨道 X：M4 收尾实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 落地 `docs/V1_TASKS.md` §9 轨道 X（X-1..X-6）：端到端走查与 Playwright 关键流、状态完整性、响应式与可达性、seed 与 README、安全走查、v1 范围复核，达成 §10 v1 Done。

**Architecture:** seed 脚本新建于 `apps/web/src/db/seed.ts`（只写脚本，不改 schema）；e2e 测试新建 `apps/web/e2e/**`（Playwright 独立 e2e 库，不触碰 dev/test 库）；走查/审计类任务产出 `docs/x-audit-*.md` 记录 + 修复提交。审计驱动修复：先盘点出缺陷清单，再逐项修，避免无的放矢。

**Tech Stack:** 现有栈 + `@playwright/test`（devDependency，e2e 专用）。

**Spec:** `docs/V1_TASKS.md` §9 轨道 X（X-1..X-6）+ §10 v1 Done；原型 `docs/prototypes/*.html`（11 页）；设计文档 `docs/2026-10-21-open-doing-v1-design.md`（§5 角色矩阵、「非目标」）。

## Global Constraints

- **Ruling（依赖）**：X-1 明确要求「补 Playwright 关键流」，故本轨道**允许**新增 devDependency `@playwright/test`（仅 e2e 用）；其余仍不新增依赖。
- **Ruling（e2e 数据库隔离）**：Playwright 使用独立 e2e 库（`open_doing_e2e`，docker initdb 脚本追加创建），`e2e` 目录内自带 migrate-then-run 的 webServer 配置；绝不指向 dev/test 库。e2e 用例自建账号（注册流），运行前 TRUNCATE e2e 库。
- 现状盘点（计划编写时核验）：看板拖卡已实现（TeamKanban/PersonalKanban，@dnd-kit）；README 已含 compose/migrate/dev/cron 章节（X-4 只补 seed + cron 触发的 cron 表达式示例）；`not-found.tsx` 存在，无 error.tsx；全仓库无 `prefers-reduced-motion`；无 useOptimistic（乐观更新回滚一项按「未使用乐观更新则不适用」处理，走查中确认）。
- 文案中文、commit 英语 + `Co-Authored-By: Claude Code <noreply@anthropic.com>`；真库测试无 mock；样式只用令牌。
- 安全走查只修实证缺陷，不重构；范围复核只对照「非目标」清单逐条记录，发现越界即删。
- 测试基线：297+15 全绿是每任务的回归底线。

## Review Focus

1. **e2e 不污染数据**：Playwright 只连 e2e 库，任何一步不写 dev/test 库 → Task 2 用例断言连接串来源（env 检查）。
2. **seed 幂等**：重复执行 seed 不产生重复数据（用固定用户名 upsert 或先 TRUNCATE 提示）→ Task 1 测试/说明。
3. **cron 关键流真实触发**：e2e 里 cron 流程必须真实 POST `/api/cron/due-scan` 并断言铃铛出现通知，不得 mock → Task 2。
4. **375px 零溢出可自动验证**：Playwright 走查脚本对全部已实现路由断言 `scrollWidth <= clientWidth` → Task 4。
5. **安全走查有据可查**：每个服务函数一行结论（文件:行 + 矩阵分支），不允许「已检查」式空话 → Task 5 产出的审计文档。

---

### Task 1: X-4 seed 脚本 + README 补全

**Files:**
- Create: `apps/web/src/db/seed.ts`（`tsx`/`node --experimental-strip-types` 直跑或复用现有迁移重放基建——实现者按仓库现有 `testing.ts` 的迁移重放模式选最简方案）
- Modify: `apps/web/package.json`（`db:seed` script）
- Modify: `apps/web/docker/initdb/01-create-test-db.sh` → 追建 `open_doing_e2e`（供 Task 2）；或新增 `02-create-e2e-db.sh`
- Modify: `README.md`（seed 用法 + cron 触发表达式示例，如 `0 9 * * *`）

**Interfaces:**
- Consumes: `schema.ts` 全表、argon2 哈希（与注册同参数）。
- Produces: `pnpm --filter @open-doing/web db:seed` 幂等写入原型示例数据。
- [ ] **Step 1: seed 数据对照原型**（`docs/prototypes/index.html`、`my-tasks.html`、`project-list.html` 等）：林夏（`doing_x7k2m9`，管理员）等 5 人（用户名/UID 对照原型，密码统一 `seed-password`）；团队「增长突击队」；3 个团队项目 + 2 个个人项目；任务日期以**今天为锚**生成（原型基准日 2026-10-21 的相对偏移：基准日任务 → 今天，+2 天 → 今天+2，依此映射，注释记录映射规则）；覆盖各状态任务（含逾期/临期/已完成/无日期）与子任务、评论、未指派任务。
- [ ] **Step 2: 实现 seed + 幂等策略**（重复执行：同用户名/UID 跳过或清空重建，二选一并写进 README）
- [ ] **Step 3: 验证** — 清空 dev 库后跑 seed 两次不报错不重复；登录林夏看 `/my` 与增长突击队概览渲染正常；README 按 15 分钟走通标准补 seed 步骤；`pnpm -r typecheck` 绿
- [ ] **Step 4: Commit** — `feat(db): prototype-faithful seed script and README setup guide`

### Task 2: X-1 Playwright 基建 + 五条关键流

**Files:**
- Create: `apps/web/e2e/{flows,utils}/**`（playwright.config 位置实现者定，webServer 启 `pnpm dev` 指向 e2e 库）
- Modify: `apps/web/package.json`（`@playwright/test` devDep + `test:e2e` script）
- Modify: `README.md`（e2e 运行说明一段）

**Interfaces:**
- Consumes: e2e 库（Task 1 追建）；`CRON_SECRET` env。
- Produces: `pnpm --filter @open-doing/web test:e2e` 五条关键流全绿。
- [ ] **Step 1: 基建** — 安装 `@playwright/test`；webServer 配置以 `DATABASE_URL=open_doing_e2e` 启动 dev server（端口与 dev 錯开，如 3100），启动前重放迁移并 TRUNCATE；`testIgnore` 确保根 vitest 不收集 e2e 目录
- [ ] **Step 2: 五条关键流**（每条一个 spec 文件，用例自建账号）：
  1. 注册 → 建个人项目 → 建任务 → 勾选子任务
  2. A 注册建团队邀请 B（UID）→ B 注册接受邀请 → B 可见团队
  3. 看板拖卡（@dnd-kit：`page.mouse` 按下-移动-释放拖到下一列，断言列归属变化）
  4. cron 提醒：建今天截止的任务 → 真实 `POST /api/cron/due-scan`（Bearer CRON_SECRET）→ 铃铛出现 `task_due_soon`，重复调用不重复计数（幂等）
  5. 解散团队：owner 二次确认 → 团队 404、侧栏消失
- [ ] **Step 3: 验证** — 五条流在本地全绿；确认 dev/test 库行数在 e2e 运行前后不变（Review Focus 1）
- [ ] **Step 4: Commit** — `test(e2e): playwright setup with five critical user flows`

### Task 3: X-1 十一页走查 + X-2 状态完整性修复

**Files:**
- Create: `docs/x-audit-walkthrough.md`（11 页逐屏比对结论：一致/偏差/已修复）
- Modify: 走查发现的缺陷对应文件（逐项小修，缺陷清单先行）

**Interfaces:**
- Consumes: Playwright MCP 浏览器（走查工具）+ seed 数据（Task 1）。
- Produces: 走查文档 + 修复提交；缺陷清单入 ledger。
- [ ] **Step 1: 逐屏走查** — 11 个原型页（login/register/invites/my-tasks/personal-project/personal-project-board/project-list/project-board/task-detail/team-overview/team-settings）对照实现页面：文案、结构、空态、已完成置灰、chip 口径；记录偏差清单（分「必修：与规格冲突」「选修：视觉细节」）
- [ ] **Step 2: X-2 清单盘点** — 全站列表/按钮逐一核对 loading、空状态、失败 message；404 页存在性（非成员路径）；表单校验错误中文展示；确认无乐观更新使用（若有则核对回滚）
- [ ] **Step 3: 修复必修项** — 每项小 commit 或合并为一个修复 commit（`fix(web): walkthrough and state-completeness fixes`）；选修项记入文档不动代码
- [ ] **Step 4: 验证** — 全量 vitest + typecheck + lint 绿；走查文档落盘
- [ ] **Step 5: Commit** — `docs(x): eleven-page walkthrough audit`

### Task 4: X-3 响应式与可达性

**Files:**
- Create: `apps/web/e2e/responsive.spec.ts`（375px 全路由零横向溢出自动断言）
- Create: `docs/x-audit-a11y.md`
- Modify: 发现的缺陷文件 + `apps/web/src/app/globals.css`（`prefers-reduced-motion` 降级块）

**Interfaces:**
- Consumes: Task 2 的 e2e 基建。
- Produces: 全路由 375px 断言用例 + a11y 审计文档。
- [ ] **Step 1: 375px 自动断言** — e2e 用例遍历已实现路由（登录态 + 未登录态），断言 `document.documentElement.scrollWidth <= innerWidth`（卡内横滚容器按仓库既有模式豁免，需注释豁免理由）
- [ ] **Step 2: 键盘与语义盘点** — 弹窗 Esc 关闭/焦点陷阱（antd Modal 自带，逐个确认用法正确未绕过）、表单 label 关联、按钮非 div、图标 aria；`prefers-reduced-motion: reduce` 降级 CSS（dnd-kit 动画/过渡）
- [ ] **Step 3: 修复 + 文档** — 修必修项，`docs/x-audit-a11y.md` 记录每项结论
- [ ] **Step 4: 验证** — e2e 全绿 + 全量 vitest + typecheck + lint；Commit — `fix(web): responsive and accessibility sweep` + `docs(x): accessibility audit`

### Task 5: X-5 安全走查

**Files:**
- Create: `docs/x-audit-security.md`
- Modify: 实证缺陷对应文件

**Interfaces:**
- Consumes: 设计文档 §5 角色矩阵；全部 `features/**/service.ts`、`actions.ts`、`app/api/**`。
- Produces: 逐服务函数审计文档（文件:行 + 矩阵分支 + 结论）。
- [ ] **Step 1: 逐函数核对** — 每个服务函数：鉴权入口（session/membership）、矩阵分支覆盖（对照现有自动化测试标注「有测试」）；cookie 属性（httpOnly/secure/sameSite/signing）；argon2 参数与注册一致；cron 密钥空值拒绝；UID 不可枚举（注册/邀请错误文案不泄露存在性）；SQL 注入面（Drizzle 参数化核查，重点 `sql` 模板内插值变量）；XSS（`dangerouslySetInnerHTML` 全仓为零）
- [ ] **Step 2: 修复实证缺陷**（如有）
- [ ] **Step 3: Commit** — `docs(x): security audit`（+ 修复 commit）

### Task 6: X-6 范围复核 + v1 Done 收尾

**Files:**
- Create: `docs/x-audit-scope.md`
- Modify: `docs/V1_TASKS.md`（X-1..X-6 勾选、轨道表 X 行 ✅ asher、§10 v1 Done 逐条核对注记）

**Interfaces:**
- Consumes: 设计文档「非目标」清单。
- Produces: 范围复核文档 + 板回写。
- [ ] **Step 1: 非目标逐条核对**（无邮箱/邮件、无密码找回、无实时推送、无文件上传——头像用用户名首字母）——grep 佐证 + 结论
- [ ] **Step 2: v1 Done 四条逐条核对**（全绿命令输出、矩阵测试覆盖引用走查/安全文档、11 页对应关系引用走查文档、README 15 分钟走通性结论）
- [ ] **Step 3: 板回写 + Commit** — `docs(tasks): mark track X complete, v1 done`（合并/tag 由收尾流程）
