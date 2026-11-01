# X1 收尾( finishing pass )Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 清偿 v1.1 挂账:设计令牌最小接线、`personal` 保留字 guard、设置页 callout 修正、e2e 补流(凭码全流程/空间切换/flow 08 团队带数据)与文档全面同步。

**Architecture:** 纯收尾,无新领域模块。令牌以 `tokens.css`(`:root` 变量)并入 `globals.css` 引入链;guard 落在 teams slug 生成的占用判定;e2e 三条改动全部流内自建数据,不碰共享 seed;文档按 §M2–M6 实现记录核对回写。

**Tech Stack:** Next.js 16 App Router、Drizzle + PostgreSQL 17、antd v6 + Tailwind CSS 4、Vitest + Playwright。

**Spec:** `docs/V1.1_TASKS.md` §X1「已定」(2026-11-01)+ §3 UI 债务清单;原型文件本轮**全部冻结不动**。

## Global Constraints

- 原型文件(`docs/prototypes/**`)一律不改;令牌移植是**复制** `design-tokens.css` 的 `:root` 内容,不是移动,原文件保持 e2e 视觉基准地位。
- `theme.ts` 仍是 antd 侧唯一令牌入口,本计划不改它的取值来源;不做全组件 var() 改造。
- 品牌字体「Canva Sans」「YS Text」不加载(无授权来源),`--font-sans` 栈原样保留回退链,偏差记入 X1 实现记录。
- e2e 沿既有模式**流内自建数据**(自注册用户、唯一前缀),不改共享 seed、不改 playwright/vitest 配置;vitest 与 e2e 严格串行,绝不并发。
- vitest/drizzle-kit 不读 `.env.local`:先 `set -a; source apps/web/.env.local; set +a`;vitest 串行(`fileParallelism: false`)。
- typecheck 顺序:先 `pnpm --filter @open-doing/web exec next typegen` 再 `pnpm typecheck`。
- git:英文提交信息,结尾 `Co-Authored-By: Claude Code <noreply@anthropic.com>`;不推送。
- 全站中文;新 UI 文案(仅 callout 一处)与 §M6 已定修正表述一致。

## Review Focus

1. **tokens.css 与 design-tokens.css 漂移**——复制件是死水,原型是活水;必须整变量清单逐条比对(数量与取值),并在 tokens.css 头注释声明来源与同步义务。钉:Task 1 验证步骤(变量名清单 diff 为空)。
2. **团队叫 "Personal" 不得破坏个人空间路由**——`/space/personal/*` 是保留树;slug guard 后该团队落 `personal-2`,个人空间照常可达。钉:Task 2 DB 测试 + e2e。
3. **凭码开关关闭后申请被拒**——`join_code_enabled=false` 时提交申请报「未开放」,不能 500 也不能静默成功。钉:Task 4 e2e。
4. **e2e 流内自建数据不得污染隔离**——全 suite 结束后的行数守卫必须继续通过(独库隔离断言)。钉:Task 7 全量 e2e 收尾输出「开发库与测试库行数未变化」。
5. **callout 文案变更不得撞死 flow 09 已有断言**——flow 09 若钉了旧文案必须同步更新,而不是让 e2e 变红或(更糟)断言失效。钉:Task 6 步骤。

---

### Task 1: tokens.css 最小接线 + 设置页次级文字换 token

**Files:**
- Create: `apps/web/src/app/tokens.css`
- Modify: `apps/web/src/app/globals.css`
- Modify: `apps/web/src/app/(dashboard)/space/personal/settings/page.tsx`

**Interfaces:**
- Consumes: `docs/prototypes/assets/design-tokens.css`(只读,作为复制源)。
- Produces: 全局生效的 `:root` 设计令牌变量(Primitive→Semantic→Component 三层,与原型同名同值);设置页次级文字改用 `--color-text-muted`。

- [ ] **Step 1: 移植 tokens.css**——新建 `apps/web/src/app/tokens.css`:头注释一行声明「复制自 docs/prototypes/assets/design-tokens.css,变量名与取值须与之保持同步;原型文件为视觉基准,本文件仅供运行时解析 var()」,然后**逐字复制**其 `:root { … }` 全部内容(三层全量,含注释可精简但变量一个不少);`[data-theme]` 预留注释一并保留。
- [ ] **Step 2: 接入 globals.css**——在两条 tailwind `@import` 之前加 `@import "./tokens.css";`;body 的 `var(--surface-subtle, #f4f5f7)` 与 `var(--ink-900, #0e1318)` 去掉硬编码 fallback(令牌已真实解析);font-family 一行不动。
- [ ] **Step 3: 设置页换 token**——`settings/page.tsx` 中所有 `text-[#9aa0a6]` 改为 `text-[color:var(--color-text-muted)]`(显式 color 提示避免 Tailwind 把任意值当 font-size);不改任何文案与结构。
- [ ] **Step 4: 验证**——(a) 变量清单比对:`grep -o '^\s*--[a-z0-9-]*:' docs/prototypes/assets/design-tokens.css | sort` 与对 tokens.css 同命令输出 diff 为空;(b) `grep -rn "9aa0a6" apps/web/src` 仅剩 theme.ts 的 `colorError: "#ff5757"` 等非次级文字用法,settings/page.tsx 无残留;(c) `pnpm --filter @open-doing/web exec next typegen && pnpm typecheck && pnpm lint && pnpm build` 全绿。
- [ ] **Step 5: Commit** — `feat(theme): ship design tokens as real css variables`

### Task 2: `personal` 保留字 guard(M2 挂账)

**Files:**
- Modify: `apps/web/src/lib/slug.ts`(新增导出常量)
- Modify: `apps/web/src/features/teams/service.ts`(`nextFreeSlug` 占用判定)
- Test: `apps/web/src/features/teams/service.test.ts`(追加用例)

**Interfaces:**
- Consumes: `nextFreeSlug(base, client)`(teams/service.ts:80,现有 `taken` Set 判定)。
- Produces: `export const RESERVED_SPACE_SLUGS: readonly string[] = ["personal"];`(slug.ts 导出);`nextFreeSlug` 对保留字与已占用 slug 同等跳过——团队名 "Personal" 落 `personal-2`,不占 `personal`。

- [ ] **Step 1: 写失败测试**(沿该文件既有 createTeam DB 用例风格)——(a) `createTeam({ name: "Personal" })` 后查询该团队 slug,断言 `slug !== "personal"` 且 `slug === "personal-2"`;(b) 对照组:普通名团队 slug 正常;(c) 断言创建后 `/space/personal` 保留树不受影响属于 e2e 范畴(Task 5),此处只钉服务层。
- [ ] **Step 2: 跑测试确认失败**——`set -a; source apps/web/.env.local; set +a; pnpm vitest run apps/web/src/features/teams/service.test.ts`,预期 (a) FAIL(现状 slug = "personal")。
- [ ] **Step 3: 实现**——slug.ts 增加 `RESERVED_SPACE_SLUGS` 与头注释(说明 `personal` 是 `/space/{spaceRef}` 的保留 spaceRef,来自 M2 实现记录);`nextFreeSlug` 循环条件改为 `!taken.has(candidate) && !RESERVED_SPACE_SLUGS.includes(candidate)`。
- [ ] **Step 4: 跑整文件测试通过**。
- [ ] **Step 5: Commit** — `fix(teams): reserve personal slug for the space tree`

### Task 3: flow 08 团队图表路径补带数据场景

**Files:**
- Modify: `apps/web/e2e/flows/08-space-analysis.spec.ts`(团队用例内自建数据并加强断言)

**Interfaces:**
- Consumes: `registerUser` / `uniqueUsername` / `uniqueLabel`(e2e/utils/flows.ts);flow 02 的「注册 → /teams/new 建团 → 落设置页 → 取 teamSlug」套路;flow 06 的团队任务 UI 创建与状态流转套路。
- Produces: 团队分析用例在真实数据上断言图表,不再只看标题与空态;不改任何生产代码。

- [ ] **Step 1: 扩团队用例**——在现有团队成员访问团队分析页用例前,经 UI 建数据:owner 注册建团 → 建一个团队项目 → 经任务创建 UI 建若干任务(至少一张 yesterday 截止、一张未来截止)→ 经窄屏状态按钮或任务详情把 yesterday 截止那张置为 done(复用 flow 06 的流转套路,不用 dnd)→ 成员访问 `/space/{slug}/analysis`。
- [ ] **Step 2: 加强断言**——统计行「本周完成」≥1;「吞吐」区块出现非零柱(本周完成落桶);「项目健康度」出现该项目行(进度条非空,已完成为分母);「成员负载分布」出现 owner 行(进行中计数);「僵尸任务」保持空态(造 14 天未动需改 `updated_at`,沿用既有豁免理由)。
- [ ] **Step 3: 跑该流**——`pnpm --filter @open-doing/web test:e2e -- flows/08-space-analysis.spec.ts` PASS。
- [ ] **Step 4: Commit** — `test(e2e): exercise team analysis charts with in-flow data`

### Task 4: e2e flow 10 凭码申请全流程

**Files:**
- Create: `apps/web/e2e/flows/10-team-join-by-code.spec.ts`

**Interfaces:**
- Consumes: `registerUser` / `uniqueUsername` / `uniqueLabel`;flow 02 的双上下文(browser.newContext)与 UID 读取套路;S3 已定文案(toast「申请已提交，等待管理员审批」、`/invites`「我的加入申请（N）」、结果 tag「已通过」绿/「未通过」灰);S1 已定(关闭 `join_code_enabled` 后申请报「未开放」)。
- Produces: 凭码申请→审批→加入全链路 e2e;选择器从 `features/teams/joins/` 组件与团队设置页读取。

- [ ] **Step 1: 写流**——一个 test 覆盖主线:owner 注册建团 → 团队设置页「凭码加入」区块读取 8 位加入码(含确认开关为开)→ B 独立上下文经 SpaceSwitcher 菜单「凭码加入」进 `/teams/join`(断言页尾互链文案)→ 填码提交 → toast「申请已提交，等待管理员审批」→ `/invites`「我的加入申请（1）」pending 可见 → owner 团队设置「加入申请」区块看到 B → **拒绝**(ConfirmModal)→ B 刷新看到「未通过」tag → B 再次提交(被拒后可再申请)→ owner **批准** → B 收到结果后 `/invites` 显示「已通过」→ B 的 SpaceSwitcher 菜单出现该团队 → B 进 `/space/{slug}/dashboard` 正常渲染。
- [ ] **Step 2: 写开关负路径**——同文件第二个 test:owner 关闭「允许凭码加入」Switch → B 提交申请 → 断言错误提示「未开放」(S1 文案,以 joins service 的实际错误文案为准,实现时核对),非 500。
- [ ] **Step 3: 通知断言(轻量)**——批准后 B 通知中心出现加入结果通知(沿 flow 02 的通知断言套路),不断言全部类型。
- [ ] **Step 4: 跑该流**——`pnpm --filter @open-doing/web test:e2e -- flows/10-team-join-by-code.spec.ts` PASS。
- [ ] **Step 5: Commit** — `test(e2e): add join-by-code approval flow`

### Task 5: e2e flow 11 空间切换

**Files:**
- Create: `apps/web/e2e/flows/11-space-switching.spec.ts`

**Interfaces:**
- Consumes: `registerUser` / `uniqueUsername` / `uniqueLabel`;SpaceSwitcher 菜单结构(个人空间 / 我的团队 / 创建团队 / 凭码加入,`selectedSpaceKey` 按 pathname 推导);Task 2 的保留字行为(顺带断言:建一个名为 "Personal" 的团队后,`/space/personal/dashboard` 仍可达)。
- Produces: 空间切换导航 e2e;选择器从 `SpaceSwitcher.tsx` 读取(antd Dropdown,点击触发后按菜单项文本定位)。

- [ ] **Step 1: 写桌面切换用例**——注册(无团队)→ 断言 `/space/personal/dashboard` 上切换器显示「个人空间」且个人项选中;经 `/teams/new` 建团(落团队设置页)→ 打开切换器,「我的团队」下出现该团队 → 点击团队项 → URL `/space/{slug}/dashboard` 且团队选中;再经切换器回个人 → URL `/space/personal/dashboard` 且个人选中。
- [ ] **Step 2: 写保留字用例**——建名为 "Personal" 的团队(经 UI)→ 断言其 slug 不是 `personal`(从 URL 读)且 `/space/personal/dashboard` 访问仍是个人 Dashboard(标题可见,非 404)。
- [ ] **Step 3: 写移动端 Drawer 用例**——375px 视口 → 汉堡按钮打开 Drawer(与桌面同一棵导航树)→ 经 Drawer 内模块项跳 Kanban → 断言 URL 与页面渲染;关闭 Drawer。
- [ ] **Step 4: 跑该流**——`pnpm --filter @open-doing/web test:e2e -- flows/11-space-switching.spec.ts` PASS。
- [ ] **Step 5: Commit** — `test(e2e): add space switching and mobile drawer navigation flow`

### Task 6: 设置页「项目排序」callout 修正 + M6 偏差记录关闭

**Files:**
- Modify: `apps/web/src/app/(dashboard)/space/personal/settings/page.tsx`(callout 一处文案)
- Modify: `apps/web/e2e/flows/09-personal-settings.spec.ts`(仅当其钉了旧文案)
- Modify: `docs/V1.1_TASKS.md`(§M6 定稿偏差记录补一笔)

**Interfaces:**
- Consumes: §M6 已定的消费点修正表述。
- Produces: 页面 callout 与真实消费点一致;原型文件保持冻结。

- [ ] **Step 1: 查旧文案引用**——`grep -rn "侧边栏空间切换器" apps/web/e2e apps/web/src` ,列出 flow 09 是否钉了该句。
- [ ] **Step 2: 改页面文案**——callout 从「排序应用于侧边栏空间切换器与个人 Dashboard 的项目列表。」改为「排序应用于个人 Kanban、项目详情页与任务详情页的项目列表。」;若 flow 09 钉了旧句,同步更新断言为新句。
- [ ] **Step 3: 回填文档**——§M6「定稿偏差记录」末尾追加:X1 已把设置页 callout 修正为真实消费点表述,偏差关闭;原型文件仍冻结。
- [ ] **Step 4: 验证**——`pnpm --filter @open-doing/web test:e2e -- flows/09-personal-settings.spec.ts` PASS。
- [ ] **Step 5: Commit** — `fix(settings): correct project ordering callout to real consumers`

### Task 7: 文档同步 + 全量验证

**Files:**
- Modify: `README.md`(`/my` 与「我的任务」占位页表述 → `/space/personal/dashboard` 与五模块;功能概览补 Calendar/Analysis/设置)
- Modify: `docs/ARCHITECTURE.md`(对照 §M2–M6 实现记录核对 §12 现状表与 §5 路由树;`settings` 已落地的核对)
- Modify: `AGENTS.md`(项目概述/模块清单如提及旧路由或缺失五模块,同步;CLAUDE.md 为其包装无需单改)
- Modify: `docs/V1.1_TASKS.md`(§X1 追加「实现记录」;§3 债务清单收尾;任务表 X1 状态 ✅)

**Interfaces:**
- Consumes: §M2–M6 各「实现记录」;Task 1–6 的实际落地结果。
- Produces: 文档与代码一致;X1 收口。

- [ ] **Step 1: README**——`grep -n "/my\b" README.md` 逐处更新:启动段「进入 /my(应用外壳 + 「我的任务」占位页)」→ 注册后进入 `/space/personal/dashboard`;「推荐用 林夏 登录查看 /my 与…」→ 五模块路径;概览段落补齐 v1.1 五模块与个人设置页。
- [ ] **Step 2: ARCHITECTURE**——核对 §12 现状表每行与 §M2–M6 实现记录一致(逐条列出不一致处并修正);§5 路由树确认 `settings`、`calendar`、`analysis` 均为真实页面描述。
- [ ] **Step 3: AGENTS.md**——若「项目概述」或架构段落后于现状(如仍称某页为占位)则同步;无过时处则不动并在 X1 实现记录注明核对结论。
- [ ] **Step 4: V1.1_TASKS.md §X1 实现记录**——沿 §M5/M6 格式:令牌接线范围与字体偏差记录、guard、三条 e2e 变更摘要、callout 修正、文档同步清单;任务表 X1 状态改 ✅;§3 债务清单标注全部收口。
- [ ] **Step 5: 全量验证(严格串行)**——(a) `set -a; source apps/web/.env.local; set +a; pnpm vitest run`;(b) `pnpm --filter @open-doing/web test:e2e`(全量,末尾行数守卫输出「开发库与测试库行数未变化」);(c) `pnpm lint && pnpm typecheck && pnpm build`。
- [ ] **Step 6: Commit** — `docs: sync readme, architecture and agents for v1.1 five modules`

## 执行期裁定预案(控制器按此裁决,不另等待)

- **flow 10/11 选择器与文案以实际组件为准**——S1/S3 已定文案若与实现存在细微出入(如「未开放」实际文案),以 `features/teams/joins` 组件/服务现值为断言基准,不回改生产代码,偏差在 X1 实现记录注明。
- **flow 08 的 done 流转方式**——窄屏状态按钮优先(与 flow 06 同路),任务详情状态切换兜底;不引入 dnd 拖拽(不稳定,flow 06 先例)。
- **tokens.css 允许精简注释但禁止精简变量**——变量清单与原型 1:1 是 Review Focus #1 的硬钉。
- **文档同步发现代码外过时描述**——纯描述性过时(README 截图路径等)顺带修正;涉及行为描述与代码不符且不确定谁对时,以代码现状为准记录,不返工代码。
- **全量验证失败**——任何一步红了即停,按 SDD 修复回路处理,不带红合并。
