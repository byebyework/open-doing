# Track X 响应式与可达性审计（2026-10-25）

X-3 逐项结论。每条给出 `file:line` 证据与判定（一致 / 已修复 / 选修-不修），
不使用「已检查」一类无证据条目。

## 1. 方法与证据

- 代码：本仓库 worktree，分支 `asher/m33`。
- 浏览器：Playwright 1.60.0（Chromium，随仓库锁定，未升级）；视口 375×667（响应式）与 1280×720（桌面语义）。
- 数据：e2e 库 `open_doing_e2e`；账号全部通过注册 UI 一次性创建，不依赖 seed 数据；
  `scripts/e2e-with-db-guard.sh` 在运行前后核对 `open_doing` / `open_doing_test` 行数未变化。
- 自动化断言：`apps/web/e2e/responsive.spec.ts`（commit `e67db05`），16 条按路由命名的用例；
  测量前等待 `document.fonts.ready` 与两帧渲染，读取 `document.documentElement.scrollWidth`
  并对越界元素做快照（失败信息直接指出元素与位置）。
- 键盘 / 语义取证：临时 Playwright 用例（运行后已删除，不入库）在真实页面执行 DOM 探针：
  `role` / `aria-*` / `labels` / Tab 轨迹 / `getComputedStyle` 过渡时长。
- 应用修复：commit `80d1bc1`（`fix(web): responsive and accessibility sweep`）。

## 2. 375px 横向溢出

判定标准：`document.documentElement.scrollWidth <= window.innerWidth`（375），
宽表沿用仓库既有的「卡内横滚」模式（见 §3）。

| 路由 | 结论 | 证据 / 说明 |
|---|---|---|
| `/login` | 一致 | 未登录访问；scrollWidth=375 |
| `/register` | 一致 | 未登录访问；scrollWidth=375 |
| `/invites`（未登录） | 一致 | 重定向到 `/login` 后断言；scrollWidth=375 |
| 未命中路由 | 一致 | 同时断言 HTTP 状态为 404；scrollWidth=375 |
| `/my` | 一致 | 两张表为卡内横滚豁免（§3），页面本身不溢出 |
| `/my/projects/[projectSlug]`（列表） | 一致 | 一张表为卡内横滚豁免（§3） |
| `/my/projects/[projectSlug]?view=board` | 一致 | 看板 375px 退化为单列 + 状态按钮（`PersonalKanban.tsx:350` `draggable={isDesktop}`） |
| `/my/tasks/[taskId]` | 一致 | 任务详情 / 子任务 / 评论区均不溢出 |
| `/invites`（已登录） | 一致 | 待处理邀请卡片不溢出 |
| `/teams/new` | 一致 | 创建团队表单不溢出 |
| `/teams/[teamSlug]`（团队概览） | 一致 | 统计卡与成员负载均换行 |
| `/teams/[teamSlug]/settings` | 已修复 | 修复前 scrollWidth=478：待处理邀请行（时间 span left=388/right=422、撤销按钮 right=478）与 `MemberList` 表格（right=393）越界；见 `80d1bc1`、§9 |
| `/teams/[teamSlug]/projects/new` | 一致 | 创建项目表单不溢出 |
| `/teams/[teamSlug]/projects/[projectSlug]`（列表） | 一致 | 一张表为卡内横滚豁免（§3） |
| `/teams/[teamSlug]/projects/[projectSlug]?view=board` | 一致 | 团队看板 375px 同样退化为单列 |
| `/teams/[teamSlug]/projects/[projectSlug]/tasks/[taskId]` | 一致 | 团队任务详情不溢出 |

## 3. 卡内横滚豁免清单

| 路由 | 容器 `file:line` | 数量 | 理由 |
|---|---|---|---|
| `/my` | `apps/web/src/features/dashboard/my-tasks/components/MyTaskTable.tsx:128` | 2 | `min-w-[760px]` 表格在卡片内横滚（个人任务 + 我负责的团队任务） |
| `/my/projects/[projectSlug]` | `apps/web/src/features/personal/tasks/components/ProjectTaskTable.tsx:158` | 1 | `min-w-[680px]` 表格在卡片内横滚 |
| `/teams/[teamSlug]/projects/[projectSlug]` | `apps/web/src/features/tasks/components/TeamProjectTaskTable.tsx:230` | 1 | `min-w-[860px]` 表格在卡片内横滚 |
| `/teams/[teamSlug]/settings` | `apps/web/src/features/teams/components/MemberList.tsx:43` | 1 | 本次按同一模式包裹成员表（`80d1bc1`） |

豁免不是「跳过断言」：`responsive.spec.ts` 对每条豁免还断言容器数量、
`overflow-x` 计算值为 `auto`/`scroll` 且 `scrollWidth > clientWidth`，
容器被误删或表格变窄后豁免会失败而不是悄悄过期。

## 4. 弹窗（Modal）键盘与语义（7 处，逐一运行验证）

仓库内全部 `<Modal>` 使用点；运行时检查 `role=dialog`、`aria-modal=true`、
`aria-labelledby` 指向可见标题、打开后焦点在弹窗内、Esc 关闭、关闭后焦点回到触发元素。
全仓库无 `keyboard={false}` / `maskClosable={false}` 覆盖（grep 结果为空），
未绕过 antd 的默认行为。

| 使用点 | 结论 | 证据 |
|---|---|---|
| `apps/web/src/components/ui/ConfirmModal.tsx:42` | 一致 | 删除任务 / 移除成员 / 散团 / 转让团队等二次确认；Esc 关闭、焦点回到触发按钮 |
| `apps/web/src/features/personal/projects/components/PersonalProjectFormModal.tsx:112` | 一致 | `afterOpenChange` + `destroyOnHidden`；标签关联见 §5 |
| `apps/web/src/features/personal/tasks/components/NewTaskModal.tsx:104` | 一致 | 同上；`destroyOnHidden` 保证重开时焦点重新进入 |
| `apps/web/src/features/dashboard/my-tasks/components/NewTaskModal.tsx:169` | 一致 | 我的任务页新建任务弹窗 |
| `apps/web/src/features/tasks/components/NewTeamTaskModal.tsx:124` | 一致 | 团队新建任务弹窗 |
| `apps/web/src/features/projects/components/TeamProjectHeaderActions.tsx:67` | 一致 | `footer={null}` 的编辑项目弹窗，Esc 仍关闭；提交按钮为表单内 `htmlType="submit"` |
| `apps/web/src/components/ui/task-detail/TaskDetailView.tsx:146` | 一致 | 编辑任务弹窗 |

## 5. 表单标签关联

| 项 | 结论 | 证据 |
|---|---|---|
| antd `Form.Item` 表单（全仓库 28 处） | 一致 | 运行时探针：8 个弹窗内所有 `input` / `textarea` 的 `labels.length` 均为 1；antd 通过 `htmlFor` / `id` 关联 |
| 表单提交按钮 | 一致 | `LoginForm.tsx:125`、`RegisterForm.tsx:170`、`CreateTeamForm.tsx:64`、`RenameTeamForm.tsx:70`、`InviteMemberForm.tsx:70`、`TeamProjectForm.tsx:128` 均为 `htmlType="submit"`，Enter 可提交 |
| 散团确认输入 | 一致 | `apps/web/src/features/teams/members/components/DissolveTeamButton.tsx:73` `<label htmlFor="dissolve-team-name">` + 对应 `<Input id="dissolve-team-name">` |
| 筛选 Select | 一致 | `ProjectTaskTable.tsx:122,130`、`TeamProjectTaskTable.tsx:177,188`、`TeamKanban.tsx:460,474`、`TaskDetailView.tsx:483` 均带 `aria-label` |
| 转让团队 Select | 已修复 | `TransferTeamButton.tsx:88` 原仅有 placeholder，现补 `aria-label="选择新的所有者"`（`80d1bc1`） |
| 评论输入框 | 已修复 | `CommentBox.tsx:147` 原仅有 placeholder，现补 `aria-label="评论内容"`（`80d1bc1`） |
| 新增子任务输入框 | 已修复 | `SubtaskList.tsx:130` 原仅有 placeholder，现补 `aria-label="新子任务的标题"`（`80d1bc1`） |

## 6. 按钮语义（`<button>` vs div）

| 项 | 结论 | 证据 |
|---|---|---|
| 普通操作控件 | 一致 | 全部使用 antd `Button` 或原生 `<button>` / `<a>`（`<Link>`）；8 个页面的运行时探针除下述 dnd-kit 把手外未发现可点击的 div/span 伪按钮 |
| 看板拖拽把手 | 一致 | 实现为 div 但采用 ARIA draggable 模式：`PersonalKanban.tsx:133-136`、`TeamKanban.tsx:183-186` 展开 dnd-kit `attributes`，运行时得到 `role=button`、`aria-roledescription="draggable"`、`aria-label=任务标题`、`tabIndex=0`、`aria-describedby`（dnd-kit 键盘操作说明）；键盘传感器已注册（`PersonalKanban.tsx:273`、`TeamKanban.tsx:355`）。探针：1280px 水合后存在 1 个把手，375px 因 `draggable={isDesktop}` 不渲染任何把手 |
| 悬停才显示的行内「删除」 | 一致 | `SubtaskList.tsx:111`、`CommentBox.tsx:122` 同时带 `focus-visible:opacity-100`，键盘聚焦时可见可操作 |

## 7. 图标控件 / 纯图标按钮的 accessible name

| 控件 | 结论 | 证据 |
|---|---|---|
| 顶栏搜索框（禁用态） | 一致 | `apps/web/src/components/layout/Topbar.tsx:62` `aria-label="搜索任务"` |
| 用户菜单触发按钮 | 一致 | `Topbar.tsx:99` `aria-label="当前用户 ${username}，打开用户菜单"` |
| 未登录头像占位 | 一致 | `Topbar.tsx:108` `role="img"` + `aria-label="未登录用户"` |
| 通知铃铛 | 一致 | `apps/web/src/features/notifications/components/NotificationBell.tsx:420` `aria-label` 含未读数（`通知，N 条未读`） |
| 任务行操作菜单 | 一致 | `apps/web/src/features/personal/tasks/components/TaskRowActions.tsx:143` `aria-label="任务「{title}」的操作"` |
| 团队任务行操作菜单 | 一致 | `apps/web/src/features/tasks/components/TeamTaskRowActions.tsx:149` 同上 |
| 侧栏「新建项目」图标按钮 | 一致 | `apps/web/src/features/personal/components/PersonalNavMenu.tsx:108` `aria-label` / `title` 均为「新建项目」 |
| 头像 | 一致 | `apps/web/src/components/ui/UserAvatar.tsx:46-47` `role="img"` + `aria-label={username}` |
| 进度条 | 一致 | `apps/web/src/components/ui/ProgressBar.tsx:27` `aria-label="进度 N%"`；antd Progress 输出 `role="progressbar"`，可访问名成立 |

## 8. 降低动态效果（`prefers-reduced-motion: reduce`）

| 项 | 结论 | 证据 |
|---|---|---|
| 全局降级规则 | 已修复 | `apps/web/src/app/globals.css:38-48` 新增媒体查询：`animation-duration` / `transition-duration` 压到 0.01ms、`animation-iteration-count: 1`、`transition-delay: 0`、`scroll-behavior: auto` |
| 覆盖范围 | 一致 | Tailwind `transition-*` 工具类、antd 过渡/动画、dnd-kit 内联 `transform` 与放置过渡（`!important` 覆盖内联 `transition`） |
| 颜色 | 一致 | 该规则只调整时长、延迟与滚动行为，未引入任何颜色值 |
| 运行时验证 | 一致 | `emulateMedia({ reducedMotion: "reduce" })` 下侧栏链接与表格行 `transitionDuration=1e-05s`；`no-preference` 时为 `0.15s` |

## 9. 必修修复（commit `80d1bc1`）

| ID | 问题 | 证据 | 修复 |
|---|---|---|---|
| R-1 | 375px 下团队设置页页面级横向溢出（scrollWidth=478） | 待处理邀请行时间/撤销按钮越界；`MemberList` 表格 right=393 | 邀请行加 `flex-wrap` + `min-w-0`（`apps/web/src/app/(dashboard)/teams/[teamSlug]/settings/page.tsx:92`）；成员表按既有模式包裹 `min-w-0 overflow-x-auto`（`MemberList.tsx:43`） |
| A-1 | 评论输入框无可访问名 | `CommentBox.tsx:143` 仅有 placeholder | 补 `aria-label="评论内容"`（`:147`） |
| A-2 | 新增子任务输入框无可访问名 | `SubtaskList.tsx:127` 仅有 placeholder | 补 `aria-label="新子任务的标题"`（`:130`） |
| A-3 | 转让团队 Select 无可访问名 | `TransferTeamButton.tsx:86` 仅有 placeholder | 补 `aria-label="选择新的所有者"`（`:88`） |
| A-4 | 缺少 reduced-motion 降级 | 仓库无 `prefers-reduced-motion` | 新增 `globals.css:38-48` |

R-1 与 A-4 均属「必修」；A-1~A-3 是同一类缺陷（仅 placeholder 的输入控件）的 3 个实例。

## 10. 选修-不修（只记录，不改代码）

| ID | 项 | 证据 | 结论 |
|---|---|---|---|
| S-1 | 通知面板（Popover）无焦点陷阱、触发按钮无 `aria-expanded` | `NotificationBell.tsx:410-428` | 非模态面板，WAI-ARIA APG 不要求陷阱；内容中的链接可 Tab 进入也可离开，触发按钮已有含未读数的 `aria-label`，故不修 |
| S-2 | 弹窗 Tab 循环中出现一次 `BODY` 焦点 | antd `@rc-component/dialog` 1.10.0 只做「打开入焦 / 关闭回焦」，无 Tab trap；连续 40 次 Tab 未触达 header/aside 控件 | 浏览器 chrome 回绕导致，背景控件不可达，不修 |
| S-3 | 无「跳到主要内容」skip link | 全仓库 grep 无 skip 目标；顶栏仅搜索/通知/用户菜单 3 个控件 | 单层布局、需跳过的前置控件很少，不修 |
| S-4 | 弹窗无 `aria-describedby` | 7 处弹窗只有 `aria-labelledby` | 标题已表达用途，不构成 WCAG 失败，不修 |

## 11. 未纳入本次范围

- 320px 及更窄视口（任务约定 375px）。
- 颜色对比度与色觉（本次范围是响应式 + 键盘/语义）。
- 弹窗内容在 375px 下的内部滚动：断言只覆盖页面级不溢出；弹窗自身 `max-height` 由 antd 处理。
