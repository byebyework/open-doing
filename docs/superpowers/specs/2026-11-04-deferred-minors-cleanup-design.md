# 评审遗留 6 项 Minor 清理设计

日期：2026-11-04
来源：antd → shadcn/ui 迁移（Plan 2）全分支 opus 评审的 6 项 deferred minor（ledger 记录于 plan-2 SDD，历史见 git）。用户决策后立项收尾。

## Intent / Why

迁移评审留下 6 项 Minor：两处行为/文档不一致（看板筛选）、一处交互回归（ConfirmModal 失败关闭）、一处 i18n 违规（硬编码 "Close"）、一处令牌卫生（字面量 hex）、一处待复核（toast 形态）。单项都小，但都是"代码会说谎"或"规则被打破"的存量，收掉后代码库回到零已知问题状态。

## Goals / Non-goals / Anti-goals

**Goals**
1. ConfirmModal：确认失败时弹窗保持打开、输入不丢（还原 antd 语义）；loading 态真正可见。
2. vendored dialog/sheet 关闭钮 sr-only 文案走 i18n（zh 用户不再听到英文 "Close"）。
3. 看板筛选语义定案并让代码与文档一致：**统计片 = 视角切换，一次只激活一个**（用户拍板）；项目/负责人 = 视角内细化，切换细化**不退出**当前视角。
4. 字面量 hex 换成等值 token 变量（仅限 tokens.css 已有 1:1 等值的）。
5. sonner toast 形态对照原型复核，偏差才修。

**Non-goals**
- 不实现统计片 AND 叠加（用户明确选了单激活视角模型）。
- 不新增 token、不改 tokens.css 取值（与 design-tokens.css 1:1 红线不变）。
- 不动 e2e 冻结断言的行为语义；选择器只允许按既有判例（data-testid / role）等价调整。
- 不触碰后端（schema / Server Action 签名 / 权限判断）。

**Anti-goals（失败形态）**
- 为换 token 而换：没有等值 token 的字面量（如 `#a66b00`、`rgba(14,19,24,0.04)` 阴影）必须保留——原型自身就用字面量，验收线是与其 1:1。
- 修复 ConfirmModal 时把成功路径改复杂：关闭仍由父组件在成功回调里置 `open=false`，不引入新的全局状态或 promise 编排。

## 用户已拍板的决策

- **筛选交互模型**：点统计片 = 切换视角（单激活）；在视角内改项目/负责人筛选，视角保持。用户原话选项："点一个数字就切到那个视角（一次看一类）"。

## 约束（引自 AGENTS.md 与迁移验收线，逐条对任务生效）

- 令牌 + 组件形态 + 文案一致；stock shadcn/Radix 默认差异不追。
- 新文案进 `src/i18n/messages/{zh,en}.json` 双目录（cjk-guard + messages-parity 强制）。
- tokens.css 零改动。
- e2e 断言不改行为语义；data-testid 全保留。
- TDD：每项修复先有失败测试。
- vitest 环境为 node + SSR 断言，交互测试归属 e2e；e2e 前停 dev server（Next 16 同目录锁）。
- 测试库环境变量用字面量传入（vitest/drizzle-kit 不读 .env.local）。

## 各项设计

### 1. ConfirmModal 显式关闭

现状：`AlertDialogAction` 点击即触发 Radix 关闭 → `onOpenChange(false)` → `onCancel()`；失败时（如 DissolveTeamButton 名称不符 toast）弹窗关闭、确认输入丢失；`loading` spinner 因立即关闭成为死代码。

改法：
- `AlertDialogAction` 的 `onClick` 改为 `e.preventDefault()` 后调 `onConfirm()`——Radix 不关闭，弹窗保持。
- 关闭责任移到消费方：成功路径上父组件把 `open` 置 false（open 本就是父组件受控）。Esc/遮罩/取消仍走 `onCancel`。
- **提交中封死侧门关闭**（builder check 后定的 call）：仅 `disabled` 取消钮不够——loading 期间 Esc / 遮罩点击仍会触发 `onOpenChange(false)`，失败丢输入的回归从侧门回来。给 `AlertDialogContent` 加 `onEscapeKeyDown` / `onInteractOutside`，`loading` 时 `preventDefault`（antd `confirmLoading` 同语义：阻止 mask/keyboard 关闭）。非 loading 态行为不变。
- **全量补 submitting 闸门**（builder check 后定的 call）：阻止自动关闭后，没有 loading 闸门的消费方会出现双击双提交窗口（如解散团队触发两次）——这是本修复自身引入的回归，必须审计全部 12 个消费文件，异步 `onConfirm` 一律有 `useState` submitting 闸门（已有的如 DissolveTeamButton 保持，缺的补上）。
- 扫描全部 12 个消费文件（TaskRowActions、PersonalProjectHeaderActions、TeamTaskRowActions、TeamProjectHeaderActions、CancelJoinRequestButton、JoinRequestList、JoinCodeSettings、LeaveTeamButton、DissolveTeamButton、TransferTeamButton、RemoveMemberButton、TaskDetailView），逐一确认成功回调里有关闭；漏的补上。
- `loading` 语义由此变真：异步提交中确认钮禁用 + spinner，失败后回到可点状态。
- **留给 builder 的注意点**：部分消费方 onConfirm 是同步 fire-and-forget（内部 await action + toast），保持该模式，只在 success 分支加关闭；不要把 onConfirm 改成返回 Promise 的契约。

### 2. vendored Close 文案 i18n

`dialog.tsx:79` 与 `sheet.tsx` 内置关闭钮的 `<span className="sr-only">Close</span>` 硬编码。改法：vendored 文件内 `useTranslations`（client 组件，next-intl 可用）取 `common.close`；zh「关闭」/en "Close" 双目录补 key。两个 vendored 文件的适配注释（"Vendored from shadcn/ui … 适配:"）追加本次适配说明。

### 3. 看板筛选语义一致化

现状（已核实）：
- `KanbanStatStrip.tsx:49` 注释声称 "chips 之间可叠加（AND）"，但 `toggle`（113-124）从 `preserveParams`（仅 project/assignee，两处调用点已核实）重建 URL → 激活新片即丢弃旧统计参数。**行为已是单激活，只有注释撒谎。**
- `SpaceKanbanFilterBar.pushFilter`（76-86）从零重建 URL → 改项目/负责人会丢弃当前统计参数（踢出视角）。

改法：
- 修正 `KanbanStatStrip` 注释为单激活视角模型（"点击 chip 切换视角，一次只激活一个；再点取消"）。
- `pushFilter` 带上当前统计参数：两个看板页把已激活的统计参数（status/overdue/dueSoon）作为新 prop（如 `statParams`）传给 `SpaceKanbanFilterBar`，`pushFilter` 构建 URL 时透传。两页（personal/team）同改。
- 测试：已有 `stat-filter.ts` 单测覆盖聚合；新增钉 URL 组合的测试——统计片激活时改项目 → URL 仍含统计参数；FilterBar 侧若可单测则单测，否则 e2e 补一条（激活「已逾期」→ 切项目 → 断言 URL 仍带 `overdue=1`）。

### 4. 字面量 hex → 等值 token

tokens.css 已核实等值映射（值 1:1，零视觉变化）：
- `#0e1318` → `var(--ink-900)`
- `#5f6368` → `var(--ink-500)`
- `#9aa0a6` → `var(--ink-400)`
- `#e1e3e6` → `var(--border-default)`

现状约 337 处、57 个文件（tsx 内 className 任意值与内联样式）。全量机械替换（sed 级）；无等值 token 的（`#a66b00`、`#ff5757`、`rgba(14,19,24,0.04)` 阴影等）保留。
- **留给 builder 的注意点**：替换后 `pnpm build` 确认 Tailwind 任意值解析正常（`text-[var(--ink-500)]` 是合法任意值）；逐文件 diff 抽查无误伤（尤其 shadow rgba 内的 `14,19,24` 不得被误改）。验证以构建 + 全量测试 + 抽屏对照为准，不需要逐屏截图审计（值恒等）。

### 5. sonner toast 形态复核

vendored `sonner.tsx` 已对齐：position bottom-right、card bg/text/border token。原型 `.toast`：fixed right/bottom 24px、popover 底、border、radius-8、shadow-popover、13px。走查核对（重点：圆角、阴影、字号、成功/错误图标色 `--success`/`--error`），有偏差才在样式层修（sonner `toastOptions` / CSS 变量），无偏差记录即收。复核动作放在实现完后与 ConfirmModal 走查同批进行（触发失败 toast + 成功 toast 各一次）。

## What's Left to the Builder

- 每项的测试切分与放置（单测 vs e2e）按"交互进 e2e、纯函数进单测"惯例。
- ConfirmModal 消费方扫描的完整清单以 grep 为准（上面 12 个文件是当前快照）。
- e2e 新用例挂靠 flow 选择（看板筛选语义 → flow 06 space-kanban 或新 describe；ConfirmModal 失败保持 → flow 05 dissolve-team 的名称不符分支）。
- 提交切分建议按项（或语义相近的 1+2、3、4、6 分组），Conventional Commits。

## 验收

- 全部 6 项以 commit messages + 本设计文档记录闭环（plan-2 的 SDD ledger 是 git-ignored scratch、已随工作区清理，不回写历史文档）；`pnpm build && pnpm typecheck && pnpm lint` 干净；全量 vitest 绿；全量 e2e 绿。
- ConfirmModal 失败路径有 e2e 钉住（弹窗保持 + 输入保留）。
- 看板 URL 组合有测试钉住（统计参数跨 FilterBar 操作存活）。
