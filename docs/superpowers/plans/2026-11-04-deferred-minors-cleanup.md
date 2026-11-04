# 评审遗留 6 项 Minor 清理 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 收掉 antd→shadcn 迁移评审遗留的 6 项 deferred minor（ConfirmModal 失败关闭、vendored Close 硬编码、看板筛选语义矛盾、筛选保留不对称、字面量 hex、sonner 形态复核）。

**Architecture:** 三组行为修复（ConfirmModal 关闭权移交消费方 + 提交中封死侧门；vendored 文案 i18n；FilterBar 透传统计参数）+ 一次机械 token 替换 + 一次原型对照走查。每项行为修复先写失败测试（交互类钉在 e2e，源码级约束用仓库已有的源文件断言判例），hex 替换与走查以构建/全量测试/截图对照为验收。

**Tech Stack:** Next.js 16 App Router / React 19 / TypeScript / Tailwind 4 / next-intl / Radix (vendored shadcn) / Playwright / Vitest

**Spec:** `docs/superpowers/specs/2026-11-04-deferred-minors-cleanup-design.md`

## Global Constraints

- tokens.css 零改动；与 `docs/prototypes/assets/design-tokens.css` 1:1 红线不变。
- 无等值 token 的字面量必须保留：`#a66b00`、`#ff5757`、`rgba(14,19,24,0.04)` 阴影等（原型自身即字面量）。
- 所有新文案进 `apps/web/src/i18n/messages/{zh,en}.json` 双目录（cjk-guard + messages-parity 强制）；硬编码用户可见文案禁止。
- e2e 冻结断言不改行为语义；全部 `data-testid` 保留；新用例 username 前缀 ≤11 字符（总长 ≤20）。
- `ConfirmModalProps.onConfirm` 保持同步 fire-and-forget 契约（`(): void`），不改成返回 Promise。
- builder-check 定案：loading 期间 Esc / 遮罩关闭被阻止（antd `confirmLoading` 语义）；12 个消费方全量审计 submitting 闸门。
- TDD：每个行为修复先有失败测试并亲眼看到失败（Task 5 走查除外，spec 明确为复核项）。
- Conventional Commits，英文 subject；e2e 运行前停掉 dev server（Next 16 同目录锁）；vitest/drizzle-kit 需先 `set -a; source apps/web/.env.local; set +a`。

## Review Focus

1. **提交中侧门关闭**：loading 期间 Esc / 遮罩点击仍触发 `onOpenChange(false)` → 输入丢失。Task 1 的 e2e 钉失败路径；reviewer 逐一核对 ConfirmModal 三个关闭通道（Action preventDefault、`onEscapeKeyDown`、`onInteractOutside`）在 loading 下全部被堵。
2. **双击双提交窗口**：阻止自动关闭后，无 submitting 闸门的异步 onConfirm 会暴露双提交。Task 1 审计步逐文件核对 12 个消费方闸门在位（今日全部已有 `loading={…}`，审计防回归）。
3. **手工 URL `status`+`overdue` 并存** → AND 过滤且两枚 chip 同时高亮：已知边界，spec 判定不修（单激活按 UI 操作口径）。reviewer 记录为已知边界即可。
4. **hex 批量替换误伤**：大写变体、`rgba(14,19,24,…)` 阴影内数字串。Task 4 以 `grep -i` 验证 + 全量 build/vitest 兜底。
5. **team kanban 页 statParams 漏传** → 团队空间切项目仍丢视角。e2e 只钉 personal 变体；reviewer 核对 team 页传参与 personal 对称。

---

### Task 1: ConfirmModal 显式关闭 + 提交中封死侧门

**Files:**
- Modify: `apps/web/src/components/ui/ConfirmModal.tsx`
- Modify（审计，按需补 `setOpen(false)`）: `apps/web/src/features/personal/tasks/components/TaskRowActions.tsx`、`apps/web/src/features/personal/projects/components/PersonalProjectHeaderActions.tsx`、`apps/web/src/features/tasks/components/TeamTaskRowActions.tsx`、`apps/web/src/features/projects/components/TeamProjectHeaderActions.tsx`、`apps/web/src/features/teams/joins/components/CancelJoinRequestButton.tsx`、`apps/web/src/features/teams/joins/components/JoinRequestList.tsx`、`apps/web/src/features/teams/joins/components/JoinCodeSettings.tsx`、`apps/web/src/features/teams/members/components/LeaveTeamButton.tsx`、`apps/web/src/features/teams/members/components/DissolveTeamButton.tsx`、`apps/web/src/features/teams/members/components/TransferTeamButton.tsx`、`apps/web/src/features/teams/members/components/RemoveMemberButton.tsx`、`apps/web/src/components/ui/task-detail/TaskDetailView.tsx`
- Test: `apps/web/e2e/flows/05-dissolve-team.spec.ts`

**Interfaces:**
- Consumes: 现有 `ConfirmModalProps`（`open`/`loading`/`onConfirm`/`onCancel`/`okButtonProps`）——公开 props 不变。
- Produces: ConfirmModal 语义变更（确认不再自动关闭；成功关闭责任在消费方 success 分支；loading 堵 Esc/遮罩）——Task 5 走查依赖此语义；消费方审计清单即本任务审计步产物。

- [ ] **Step 1: 写失败 e2e——确认失败时弹窗保持且输入保留**

在 `apps/web/e2e/flows/05-dissolve-team.spec.ts` 的 `test.describe` 内追加（放在现有 test 之后）：

```ts
  test("确认名称不符时弹窗保持打开且输入保留", async ({ page }) => {
    const username = uniqueUsername("e2e_dismis");
    const teamName = uniqueLabel("E2E keep modal");

    await registerUser(page, username);
    await page.goto("/teams/new");
    await page.getByTestId(TEST_IDS.teams.teamNameInput).fill(teamName);
    await page.getByTestId(TEST_IDS.teams.createTeamButton).click();
    await expect(page).toHaveURL(/\/space\/[^/]+\/settings$/, {
      timeout: 30_000,
    });

    await page.getByTestId(TEST_IDS.teamDanger.dissolveTeamButton).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();

    // 名称不符 → toast 报错；弹窗必须保持打开且输入不丢（antd confirm 语义）。
    const wrongName = uniqueLabel("Wrong name");
    await dialog
      .getByTestId(TEST_IDS.teamDanger.dissolveConfirmInput)
      .fill(wrongName);
    await dialog.getByTestId(TEST_IDS.teamDanger.dissolveConfirmButton).click();

    await expect(page.locator("[data-sonner-toast]")).toBeVisible();
    await expect(dialog).toBeVisible();
    await expect(
      dialog.getByTestId(TEST_IDS.teamDanger.dissolveConfirmInput),
    ).toHaveValue(wrongName);
  });
```

- [ ] **Step 2: 运行确认 RED**

先停 dev server（若有）。运行：`pnpm --filter @open-doing/web test:e2e -- flows/05-dissolve-team.spec.ts`
Expected: 新用例 FAIL 在 `await expect(dialog).toBeVisible()`（现状 Radix Action 自动关闭）；既有用例「owner 二次确认后团队被删除」PASS。

- [ ] **Step 3: 改 ConfirmModal——preventDefault + 侧门封死**

`apps/web/src/components/ui/ConfirmModal.tsx`：

`AlertDialogContent` 追加两个 props（loading 时阻止 Esc / 遮罩关闭，antd `confirmLoading` 同语义）：

```tsx
<AlertDialogContent
  role="dialog"
  onEscapeKeyDown={(event) => {
    if (loading) event.preventDefault();
  }}
  onInteractOutside={(event) => {
    if (loading) event.preventDefault();
  }}
>
```

`AlertDialogAction` 的 `onClick` 改为：

```tsx
onClick={(event) => {
  // Radix Action 默认点击即关弹窗;preventDefault 后关闭责任移到
  // 消费方 success 分支,失败时弹窗保持、输入不丢,loading 态可见。
  event.preventDefault();
  onConfirm();
}}
```

组件头注释同步改写：关闭（取消/Esc/遮罩，非 loading 时）统一走 `onCancel`；确认成功由消费方置 `open=false`。公开 props 与 e2e testid 契约不变。

- [ ] **Step 4: 审计 12 个消费文件**

逐文件（Files 列表）读确认回调，核对两点，缺一补一：
1. **success 分支关闭**：action 返回 `ok`（或等价成功出口）路径上调用 `setOpen(false)`。LeaveTeamButton / DissolveTeamButton / TransferTeamButton / RemoveMemberButton 已有，核对即可；其余按各文件现有 success 分支补上。
2. **submitting 闸门在位**：异步确认一律有 `useState` submitting + `loading={submitting}` 透传（今日 12 个全部已有——`deleting` / `submitting` / `declining` / `resetting`；核对防回归，不重构）。
失败 / 早退路径保持打开，不加关闭。不改 `onConfirm` 签名。

- [ ] **Step 5: 运行确认 GREEN**

运行：`pnpm --filter @open-doing/web test:e2e -- flows/05-dissolve-team.spec.ts`
Expected: 两条用例全 PASS（新失败路径钉住 + 既有成功路径证明消费方 success 关闭已接好）。

再跑全量 web 单测：`set -a; source apps/web/.env.local; set +a && pnpm vitest run apps/web/src/components/ui/AtomsShadcn.test.tsx`
Expected: PASS（ConfirmModal 关闭态 SSR 用例不受影响）。

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/components/ui/ConfirmModal.tsx apps/web/e2e/flows/05-dissolve-team.spec.ts apps/web/src/features apps/web/src/components/ui/task-detail/TaskDetailView.tsx
git commit -m "fix(ui): keep confirm modal open on failure and close explicitly on success"
```

---

### Task 2: vendored Close 文案 i18n

**Files:**
- Modify: `apps/web/src/components/ui/shadcn/dialog.tsx`（约 :79）、`apps/web/src/components/ui/shadcn/sheet.tsx`（约 :81）
- Modify: `apps/web/src/i18n/messages/zh.json`、`apps/web/src/i18n/messages/en.json`（`common` 命名空间新增 `close`）
- Test: `apps/web/src/components/ui/AtomsShadcn.test.tsx`

**Interfaces:**
- Consumes: next-intl `useTranslations("common")`（vendored 文件均已是 client 组件）。
- Produces: `common.close`（zh「关闭」/ en "Close"）——后续任何 vendored 关闭钮复用此 key。

- [ ] **Step 1: 写失败测试——vendored 源文件不再硬编码 Close**

`apps/web/src/components/ui/AtomsShadcn.test.tsx` 末尾追加（沿用该文件已有的源文件断言判例；vitest 为 node 环境、Radix portal 内容无法 SSR 渲染，故断言源码而非渲染 HTML）：

```tsx
  it("Dialog/Sheet 内置关闭钮 sr-only 文案走 i18n(useTranslations)", () => {
    for (const file of ["shadcn/dialog.tsx", "shadcn/sheet.tsx"]) {
      const source = readFileSync(
        path.join(import.meta.dirname, file),
        "utf8",
      );
      expect(source, `${file} 仍硬编码 Close`).not.toContain(">Close</span>");
      expect(source, `${file} 缺 useTranslations`).toContain(
        'useTranslations("common")',
      );
    }
  });
```

（该文件已 import `readFileSync` / `path`，直接复用。）

- [ ] **Step 2: 运行确认 RED**

运行：`pnpm vitest run apps/web/src/components/ui/AtomsShadcn.test.tsx`
Expected: 新用例 FAIL——两文件含 `>Close</span>` 且无 `useTranslations`。

- [ ] **Step 3: 改 vendored 文件与目录**

1. `dialog.tsx` / `sheet.tsx` 各自：`import { useTranslations } from "next-intl";`；在含关闭钮的 Content 组件内 `const t = useTranslations("common");`，`<span className="sr-only">{t("close")}</span>`。
2. 两个 vendored 文件头部适配注释（"Vendored from shadcn/ui … 适配:"）各追加一行：`关闭钮 sr-only 文案走 next-intl(common.close),不硬编码英文。`
3. `zh.json` 的 `common` 内新增 `"close": "关闭"`；`en.json` 的 `common` 内新增 `"close": "Close"`（两文件 `common` 键序保持一致，插在 `"cancel"` 之后）。

- [ ] **Step 4: 运行确认 GREEN**

运行：`pnpm vitest run apps/web/src/components/ui/AtomsShadcn.test.tsx apps/web/src/i18n/cjk-guard.test.ts apps/web/src/i18n/messages-parity.test.ts`
Expected: 全 PASS（源文件断言绿 + 双目录键结构一致 + 无 CJK 违规）。

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/ui/shadcn/dialog.tsx apps/web/src/components/ui/shadcn/sheet.tsx apps/web/src/i18n/messages/zh.json apps/web/src/i18n/messages/en.json apps/web/src/components/ui/AtomsShadcn.test.tsx
git commit -m "fix(i18n): translate vendored dialog and sheet close labels"
```

---

### Task 3: 看板筛选语义一致化（单激活视角 + 细化不丢视角）

**Files:**
- Modify: `apps/web/src/features/kanban/components/KanbanStatStrip.tsx`（:49 注释）
- Modify: `apps/web/src/features/kanban/components/SpaceKanbanFilterBar.tsx`（props + `pushFilter`）
- Modify: `apps/web/src/app/(dashboard)/space/personal/kanban/page.tsx`、`apps/web/src/app/(dashboard)/space/[teamSlug]/kanban/page.tsx`
- Test: `apps/web/e2e/flows/06-space-kanban.spec.ts`

**Interfaces:**
- Consumes: `parseStatFilterParams`（`features/kanban/stat-filter.ts`，返回 `{ status?: TaskStatus; overdueOnly?: boolean; dueSoonOnly?: boolean }`）；`TEST_IDS.kanban.projectFilter`（`"kanban-project-filter"`）。
- Produces: `SpaceKanbanFilterBarProps.statParams?: Record<string, string>`——两页传入当前激活统计参数，`pushFilter` 构建 URL 时透传。

- [ ] **Step 1: 写失败 e2e——激活统计片后切项目，视角保持**

在 `apps/web/e2e/flows/06-space-kanban.spec.ts` 统计带 describe 内追加（复用该文件已 import 的 `createPersonalProject` / `createPersonalTask` / `openPersonalProject` / `uniqueLabel` / `uniqueUsername`，import 缺哪个补哪个）：

```ts
  test("激活已逾期视角后切换项目,统计参数保留", async ({ page }) => {
    const username = uniqueUsername("e2e_kstat2");
    const projectName = uniqueLabel("E2E kb stat keep");
    const overdueTask = uniqueLabel("E2E kb stat keep overdue");

    await registerUser(page, username);
    await createPersonalProject(page, projectName);
    await openPersonalProject(page, projectName);
    await createPersonalTask(page, { title: overdueTask, dueDate: "2020-01-01" });

    await page.goto("/space/personal/kanban");
    const overdueChip = page.locator('[data-filter="overdue"]');
    await overdueChip.click();
    await expect(page).toHaveURL(/\/space\/personal\/kanban\?overdue=1$/);

    // 视角内细化:切到项目 A,已逾期视角必须跟着走(URL 仍带 overdue=1,chip 仍激活)。
    await page.getByTestId(TEST_IDS.kanban.projectFilter).click();
    await page
      .getByRole("option", { name: new RegExp(`^${projectName}`) })
      .click();

    await expect(page).toHaveURL(new RegExp(`project=${personalProjectSlug(projectName)}`));
    await expect(page).toHaveURL(/overdue=1/);
    await expect(overdueChip).toHaveAttribute("aria-pressed", "true");
  });
```

（若该文件尚未 import `personalProjectSlug`，从 `../utils/flows` 补上。）

- [ ] **Step 2: 运行确认 RED**

运行：`pnpm --filter @open-doing/web test:e2e -- flows/06-space-kanban.spec.ts`
Expected: 新用例 FAIL 在第二条 URL 断言（现状 `pushFilter` 从零重建 URL，`overdue=1` 被丢弃）；既有用例全 PASS。

- [ ] **Step 3: 实现——FilterBar 透传统计参数**

1. `KanbanStatStrip.tsx:49` 注释改为单激活口径：`统计即筛选：点击 chip 切换视角，一次只激活一个（再点取消）；project / assignee 是视角内细化，经 preserveParams 保留。`
2. `SpaceKanbanFilterBarProps` 新增：

```ts
  /** 当前激活的统计参数（status / overdue / dueSoon）；pushFilter 重写 URL 时透传，视角内细化不退出视角。 */
  statParams?: Record<string, string>;
```

组件参数解构加 `statParams`；`pushFilter` 开头（设置 project 之前）加：

```ts
    for (const [key, value] of Object.entries(statParams ?? {})) {
      params.set(key, value);
    }
```

3. 两个看板页各自在 `statFilter` 解析后计算并传给 `<SpaceKanbanFilterBar>`（personal 页与 team 页同构）：

```ts
  const activeStatParams = {
    ...(statFilter.status ? { status: statFilter.status } : {}),
    ...(statFilter.overdueOnly ? { overdue: "1" } : {}),
    ...(statFilter.dueSoonOnly ? { dueSoon: "1" } : {}),
  };
```

`statParams={activeStatParams}`。

- [ ] **Step 4: 运行确认 GREEN**

运行：`pnpm --filter @open-doing/web test:e2e -- flows/06-space-kanban.spec.ts`
Expected: 全 PASS（新用例 + 既有统计带 / 深链接用例均不回归）。

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/features/kanban/components/KanbanStatStrip.tsx apps/web/src/features/kanban/components/SpaceKanbanFilterBar.tsx "apps/web/src/app/(dashboard)/space/personal/kanban/page.tsx" "apps/web/src/app/(dashboard)/space/[teamSlug]/kanban/page.tsx" apps/web/e2e/flows/06-space-kanban.spec.ts
git commit -m "fix(kanban): carry active stat filter when refining project or assignee"
```

---

### Task 4: 字面量 hex → 等值 token（机械替换）

**Files:**
- Modify: `apps/web/src/**/*.tsx`（约 57 个文件、337 处；仅 `.tsx`，tokens.css 不在替换范围）

**Interfaces:**
- Consumes: tokens.css 既有变量 `--ink-900` / `--ink-500` / `--ink-400` / `--border-default`（值已核实 1:1）。
- Produces: 无接口变化——纯样式等值替换，零视觉变化。

- [ ] **Step 1: 基线盘点**

```bash
cd apps/web/src && grep -rn "#0e1318\|#5f6368\|#9aa0a6\|#e1e3e6" --include="*.tsx" . | wc -l
```
Expected: 约 337（记录确切数字，Step 4 归零对照）。另跑 `grep -rni "#0E1318\|#5F6368\|#9AA0A6\|#E1E3E6" --include="*.tsx" .` 确认无大写变体（有则一并计入替换范围）。

- [ ] **Step 2: 执行替换**

对 `apps/web/src` 下全部 `.tsx` 执行四处字面量 → 变量替换（sed 一次跑完四个映射）：

```bash
cd apps/web/src && grep -rl "#0e1318\|#5f6368\|#9aa0a6\|#e1e3e6" --include="*.tsx" . | while read -r f; do
  sed -i '' -e 's/#0e1318/var(--ink-900)/g' -e 's/#5f6368/var(--ink-500)/g' -e 's/#9aa0a6/var(--ink-400)/g' -e 's/#e1e3e6/var(--border-default)/g' "$f"
done
```

注意：只替换小写精确字面量；`rgba(14,19,24,0.04)`、`#a66b00`、`#ff5757` 等不在映射内，必须原样保留。替换后抽查 3-4 个文件的 diff，确认无误伤（尤其 Tailwind 任意值语法 `text-[var(--ink-500)]`、shadow 内的 var 合法性）。

- [ ] **Step 3: 验证归零 + 构建 + 全量测试**

```bash
cd apps/web/src && grep -rn "#0e1318\|#5f6368\|#9aa0a6\|#e1e3e6" --include="*.tsx" . | wc -l   # Expected: 0
cd /Users/wangtao/sourcecode/open-doing && pnpm build
set -a; source apps/web/.env.local; set +a && pnpm test
```
Expected: grep 0；build 成功（Tailwind 任意值解析通过）；vitest 全绿。

- [ ] **Step 4: Commit**

```bash
git add apps/web/src
git commit -m "refactor(ui): replace literal hex values with equivalent token variables"
```

---

### Task 5: sonner toast 形态走查（对照原型，偏差才修）

**Files:**
- Modify（仅偏差时）: `apps/web/src/components/ui/shadcn/sonner.tsx`

**Interfaces:**
- Consumes: Task 1 语义（dissolve 名称不符触发失败 toast）；vendored `sonner.tsx`（position bottom-right、`--normal-bg/border/text` 已映射 token）。
- Produces: 走查结论（记入 ledger）；如有偏差则 toast 样式修正。

- [ ] **Step 1: 起服务并触发两类 toast**

`pnpm dev`（或 e2e 环境同构方式），登录后：
1. 成功 toast：新建个人任务（「任务已创建」）。
2. 失败 toast：团队设置 → 解散团队 → 输入错误名称 → 确认（Task 1 修复后弹窗保持，toast 同时可见，正好一并核对 ConfirmModal 走查项）。

- [ ] **Step 2: 对照原型记录结论**

原型基准 `docs/prototypes/assets/prototype.css` 的 `.toast`：fixed right 24px / bottom 24px、popover 底色与描边、radius 8px、shadow-popover、字号 13px。用 Playwright 截图对照（重点：圆角、阴影、字号、成功/错误图标色 `--success` / `--error`）。
- 无偏差：ledger 记录「sonner 形态走查通过,无代码改动」，任务完成。
- 有偏差：仅在 `sonner.tsx` 的 `toastOptions` / CSS 变量层修正，改动最小化；截图前后对比记入 ledger；单独 commit `fix(ui): align sonner toast styling with prototype`。

---

### Task 6: 全量验收

**Files:**
- Modify: 无（纯验证；发现回归回到对应任务修复）

- [ ] **Step 1: 静态与单测门**

```bash
pnpm build && pnpm typecheck && pnpm lint
set -a; source apps/web/.env.local; set +a && pnpm test
```
Expected: 全绿。

- [ ] **Step 2: e2e 全量门**

停 dev server。`pnpm --filter @open-doing/web test:e2e`
Expected: 全绿（48 条既有 + Task 1/3 新增 2 条）。

- [ ] **Step 3: ledger 收尾**

确认 6 项闭环记录（commit + 本计划任务完成行）齐全；Task 5 走查结论在案。任何未闭环项回到对应任务，不得在本任务内顺手实现。
