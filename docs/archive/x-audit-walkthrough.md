# Track X 十一页走查审计（2026-10-25）

对照 `docs/prototypes/` 下 11 个静态原型，逐屏走查真实应用（Next.js App Router + 真实 seed 数据），
并完成 X-2 状态完整性盘点（loading / 空状态 / 失败提示 / 404 / 表单校验 / 乐观更新回滚）。

## 1. 走查环境与方法

- 代码：本仓库 worktree，分支 `asher/m33`。
- 数据库：docker compose 的 PostgreSQL 开发库 `open_doing`（29 个任务、5 个项目、种子用户 7 个）。
  为不改动共享环境，走查未使用 `open_doing_test` / `open_doing_e2e`，也未重启 docker compose。
- 浏览器：Playwright MCP，手动逐屏访问 + 无障碍快照（`.playwright-mcp/page-*.yml`）+ 截图；
  另外执行了登录/注册/校验/404 等交互，截图证据见 `404-team-nonmember.png`（临时文件，未入库）。
- 登录账号：林夏 / `seed-password`（团队管理员）；另通过 UI 注册一次性账号 `walkthrough_probe` 验证非成员 404。
- **开发库角色修复（环境数据，不是应用缺陷）**：走查前开发库仍是旧 seed 写入的角色
  （林夏 `owner`、周牧 `admin`，团队 `owner_id=林夏`），与 Task 1 已提交的 seed
  （`bacb8ef`：周牧 `owner`、林夏 `admin`）不一致。已用一次性 SQL 将开发库恢复为 seed 意图：
  `林夏 → admin`、`周牧 → owner`、`growth-squad.owner_id → 周牧`。
  **未修改 seed 脚本**；该修复只影响本地开发数据，最终证据里的团队设置页角色与原型一致。
- **:3000 容器路由缓存**：docker compose 的 `web` 容器（:3000）对 `/my` 仍返回 M0 占位页
  （其余路由正常），与源码不一致；按任务约束不重启容器，改由 worktree 启动
  独立 dev server（:3001，连接同一开发库）完成全部走查。该现象是容器内 Next dev 缓存问题，
  不是应用代码缺陷，已记入遗留风险。

## 2. 十一页结论总览

| # | 原型 | 真实路由 | 结论 |
|---|---|---|---|
| 1 | `login.html` | `/login` | **一致**（品牌区文案/三点/登录表单/“v1 暂不支持找回密码”/渐变按钮/注册链接全部对齐；原型预填 demo 账号属演示数据，未实现为预填） |
| 2 | `register.html` | `/register` | **偏差-选修**：共用登录页品牌区文案与三点（原型是注册专属文案，`register.html:18-20`）；用户名字符提示为 2–20（原型 4–20，`register.html:39`，见 §4 N-A-2）。表单结构、确认密码错误、UID callout 均一致 |
| 3 | `invites.html` | `/invites` | **偏差-必修（已修复 F-2）**：callout 指向不存在的“侧栏底部 UID”入口；其余 ✓。选修：h1 22px（原型 30px）、待处理卡片缺“项目数”、无侧栏用户卡（全局） |
| 4 | `my-tasks.html` | `/my` | **偏差-必修（已修复 F-1）**：页头缺“新建项目”入口（原型 `my-tasks.html:162`；设计文档 §9.2/§9.4 明确要求）。选修：列表用表格而非复选框行、无行内完成、统计卡 hint 文案、排序把已完成排在前、团队 chip 带团队名前缀 |
| 5 | `personal-project.html` | `/my/projects/learning-growth` | **一致**：标题/副标题（`个人项目 · 仅自己可见 · N 个任务`）、列表-看板切换、状态/排序筛选、`共 N 条`、4 列表格、已完成行置灰划线均对齐；额外“编辑/删除”是设计文档 §9.4 要求。任务数 9 vs 原型 8 属 seed 数据差异 |
| 6 | `personal-project-board.html` | `/my/projects/learning-growth?view=board` | **一致**：三列 未开始/进行中/已完成、列计数、卡片（截止日期/进度/完成态）、空列“＋”入口；原型“拖放仅为原型演示”的 callout 正确地未实现 |
| 7 | `project-list.html` | `/teams/growth-squad/projects/website-redesign` | **一致**：`12 个任务 · 5 位成员参与`（数量为 seed 数据）、状态/责任人/排序筛选、`共 12 条`、5 列表格、未指派、分页（上一页/页码/下一页）均对齐；进度额外显示百分比。任务数 12 vs 原型 18 属 seed 数据差异 |
| 8 | `project-board.html` | `/teams/growth-squad/projects/website-redesign?view=board` | **一致**：副标题、三列、卡片（责任人/截止/进度）、完成态；额外提供状态/责任人筛选条（原型无，属增强）；演示 callout 未实现正确 |
| 9 | `task-detail.html` | `/teams/growth-squad/projects/website-redesign/tasks/:id`；个人态 `/my/tasks/:id` | **偏差-必修（已修复 F-3）**：个人无项目任务的返回链接写“返回项目”却指向 `/my`。其余一致：返回链接、状态/截止标签、描述、`任务进度 · 3/5 个子任务 60%`、子任务勾选、评论流/发表、右侧状态更改/责任人/截止/所属项目/创建人/进度/权限 callout/编辑/标记完成/删除 |
| 10 | `team-overview.html` | `/teams/growth-squad` | **偏差-选修**：统计卡 hint、项目健康度缺“已完成数”、成员负载无角色 tag 与负载圆点、未指派用独立区块而非底部 callout；页头无“新建项目”属 N-A（设计文档 §9.3 规定只读仪表盘）。数据计数（3 逾期/3 临期等）随 seed 变化 |
| 11 | `team-settings.html` | `/teams/growth-squad/settings` | **偏差-选修**：h1 22px（原型 30px）、副标题为“管理团队信息与成员。”（原型“仅团队所有者与管理员可见”，但本实现允许成员只读进入并退出团队，故有意偏离）、创建时间行省略“团队 ID 不必显示”、无“设为成员”降级（v1 规格未要求）、转让团队放在危险区而非成员行。角色/移除/邀请/撤销/散团二次确认均对齐 |

## 3. 必修偏差清单（本任务已修复，commit `2ceb563`）

| ID | 页面 | 偏差 | 依据 | 修复 |
|---|---|---|---|---|
| F-1 | `/my` 页头 | 只有“＋ 新建任务”，缺个人项目创建入口 | 设计文档 §9.2「可从此处新建个人项目」、§9.4「个人项目的创建入口在个人空间侧栏与“我的任务”页头部」；原型 `my-tasks.html:162` | 新增 `NewPersonalProjectButton`（复用 `PersonalProjectFormModal`，成功后 `router.refresh()` 同步列表与侧栏）；页头顺序“新建项目 → 新建任务”。按钮文案为“＋ 新建个人项目”，以避免与侧栏同名图标按钮的 accessible name 冲突（e2e 依赖侧栏入口，e2e 未改动） |
| F-2 | `/invites` 提示条 | “你可以在侧栏底部随时查看自己的 UID”指向不存在的侧栏用户卡，误导用户 | 原型 `invites.html:163` 写的是“个人资料”；本实现侧栏无用户卡、用户菜单也无 UID，两处入口都不存在 | 改为直接陈述：“…；你的 UID 是 `doing_xxxx`。” |
| F-3 | 个人任务详情返回链接 | 不属于项目的个人任务，链接指向 `/my` 但文案为“← 返回项目” | 原型 `task-detail.html:150` 是团队页语境；`/my` 不是项目页 | `TaskDetailView` 增加可选 `backLabel`（默认仍为“← 返回项目”）；个人任务无项目时传“← 返回我的任务” |

修复文件：

- `apps/web/src/features/personal/projects/components/NewPersonalProjectButton.tsx`（新增）
- `apps/web/src/app/(dashboard)/my/page.tsx`
- `apps/web/src/app/(dashboard)/invites/page.tsx`
- `apps/web/src/app/(dashboard)/my/tasks/[taskId]/page.tsx`
- `apps/web/src/features/personal/tasks/components/TaskDetailClient.tsx`
- `apps/web/src/components/ui/task-detail/TaskDetailView.tsx`
- `apps/web/src/components/ui/task-detail/types.ts`

## 4. 选修偏差登记（只记录，不改代码）

| ID | 页面 | 差异 | 原型/规格依据 | 备注 |
|---|---|---|---|---|
| O-1 | `/register`、`/login` | 两页共用同一套品牌区文案与三点（注册页显示登录页文案） | `login.html:18-20`、`register.html:18-20` | 纯视觉/文案 |
| O-2 | `/register` 用户名提示 | 提示“2–20 个字符，全局唯一…”；原型“4–20 位字母、数字或下划线” | `register.html:39` | **N-A**：设计文档 §3 将长度/字符集交给实现；Task 1 已冻结 `USERNAME_MIN_LENGTH=2`，按规划不为原型旧文案回改 |
| O-3 | 全局外壳 | 侧栏无底部用户卡（头像/用户名/UID）；顶栏显示品牌名而非面包屑；搜索框禁用 | 各原型侧栏 `.sidebar-user`、顶栏 `.breadcrumb`；原型搜索亦为静态 | 走查证据：侧栏仅“账号 → 待处理邀请”；F-2 的误导正源于此缺口 |
| O-4 | `/my` 个人任务区 | 用 5 列表格（任务/项目/状态/截止/进度）替代原型复选框行；无行内勾选完成 | `my-tasks.html:185-237` | 设计文档 §9.2 未规定行内完成；任务详情/项目页可改状态。属结构/交互取舍 |
| O-5 | `/my` 统计卡 | hint 为“跨全部空间/建议优先处理/请尽快处理/自本周一以来”；原型为“较上周 +N”等 delta 文案 | `my-tasks.html:172-175` | 纯视觉；且 delta 需要历史快照，数据层不支持 |
| O-6 | `/my` 列表排序 | 严格按截止日期升序（无日期最后），已完成任务（10-15/10-18/10-21）排在最前；原型把已完成行放在末尾 | `my-tasks.html:185-237`（224 为已完成行） | 设计文档 §9.2 明确“具体排序由实现确定”，service 单测也固定了该排序；如要改需同步测试，属产品决策 |
| O-7 | `/my` 团队任务 chip | 显示“增长突击队 / 官网改版”；原型只显示项目名 | `my-tasks.html:241+` | 跨团队聚合时团队名前缀有信息价值，设计文档 §9.2 要求跨团队 |
| O-8 | `/invites` | h1 22px（原型 30px）；待处理卡片无“项目数”；侧栏无“待处理邀请”数量角标 | `invites.html`；设计 token `--text-h1:30px` | 纯视觉；角标需全局邀请计数 |
| O-9 | 项目列表（团队） | 进度列“3/5 子任务 · 60%”（原型“3/5 子任务”）；任务总数/分页页数随 seed 数据 | `project-list.html:179,276` | 纯视觉；分页已实现 |
| O-10 | 团队看板 | 额外提供状态/责任人筛选条（原型无） | `project-board.html` | 增强，无冲突 |
| O-11 | `/teams/[slug]` 页头 | 无“新建项目”按钮 | 原型 `team-overview.html` 页头有；设计文档 §9.3 规定只读仪表盘 | **N-A**：按规格保持只读；建项目入口在侧栏与项目页 |
| O-12 | 团队概览信息密度 | 项目健康度仅“N 个任务”（原型“N 个任务 · M 已完成”）；成员负载无角色 tag/负载圆点；统计卡 hint 与未指派区形式不同 | `team-overview.html:184+, 296-339` | 纯视觉/信息展示；数据均已聚合正确，成员行可展开下钻 |
| O-13 | `/teams/[slug]/settings` | h1 22px；副标题不同（实现允许成员只读进入并退出团队）；创建时间无“团队 ID 不必显示”；无“设为成员”；转让团队位于危险区 | `team-settings.html:147,159,229,274-286` | 副标题为有意的语义修正（成员确实可见只读页）；“设为成员”不在 v1 权限表内（权限表只有 owner/admin/member 治理项） |
| O-14 | 路由级 loading / error | 全站无 `loading.tsx` / `error.tsx`；导航期间无骨架屏，未捕获的 RSC 异常走 Next 默认错误页 | X-2 状态盘点 | 表单/按钮级 `loading` 与 server action 失败提示齐全；RSC 渲染很快，v1 未要求骨架屏。建议后续补路由级 `loading.tsx` 与中文 `error.tsx` |
| O-15 | 数据差异（N-A） | 个人项目 9 vs 原型 8 个任务；官网改版 12 vs 18；无 seed 邀请（待处理/已发出均为 0）；无 seed 通知（铃铛为空） | seed 数据，本任务禁止改 seed | 计数与空态本身工作正常；空态文案均验证通过 |

统计：必修 **3** 项（已修复）；选修 **14** 项（O-1…O-14，其中 O-2/O-11 为规格允许的 N-A）；数据差异 1 项（O-15，N-A）。

## 5. X-2 状态完整性盘点

### 5.1 列表 / 按钮的 loading、空状态、失败提示

| 界面 | 空状态 | 失败提示 | loading | 证据 |
|---|---|---|---|---|
| `/my` 个人任务 / 团队任务 | “暂无个人任务”“暂无团队任务”+ 引导文案 | 新建任务弹窗表单错误 + 网络异常提示 | 提交按钮 `loading` | 用一次性账号注册后实测两段空态 |
| `/invites` | “暂无邀请”+ 引导；待处理 0 时“没有待处理的邀请。” | 接受/拒绝按钮失败走 `message.error` | 按钮级 loading | 实测空态截图；代码核对 `InviteRespondButtons` |
| 通知铃铛 | “暂无通知”，“全部已读”在空列表时禁用 | 轮询/已读失败提示 | — | 实测弹层 |
| 个人项目列表/看板 | 无任务与“没有符合筛选条件的任务”（含清除筛选）；看板空列有“＋” | 行操作/拖拽失败 `message.error` | 按钮级 | 代码核对；看板空列实测 |
| 团队项目列表/看板 | 同上 | 同上 | 按钮级 | 代码核对 |
| 任务详情 | “暂无描述”“暂无评论” | 每个 action 失败 `message.error`，删除失败留在当前页 | 按钮级 | 个人/团队详情实测 |
| 团队概览 | 成员负载空态；未指派 0 时区块文案 | 只读，无写操作 | — | 实测 |
| 团队设置 | 已发出待处理 0 时显示标题（0）不渲染行 | 改名/邀请/移除/退出/转让/解散均有中文字段或表单错误 | 提交按钮 loading | 实测改名空值、无效 UID；散团需输入团队名二次确认 |
| 登录/注册 | — | 中文校验：请输入用户名/密码、请再次输入密码、两次输入的密码不一致、用户名或密码错误 | 提交按钮 loading | 全部实测 |

### 5.2 404 页存在性（非成员路径）

- 用 UI 注册的 `walkthrough_probe`（非团队成员）访问 `/teams/growth-squad`：**HTTP 404**，
  渲染中文 404 页（“抱歉，你访问的页面不存在。”+ 返回首页）。截图 `404-team-nonmember.png`。
- 同账号访问 `/teams/growth-squad/settings`：**HTTP 404**。
- 未知路由 `/definitely-not-a-page`：**HTTP 404**（独立 404 页，无应用外壳）。
- 跨空间任务 ID：林夏访问团队任务 ID 的 `/my/tasks/:id`：**HTTP 404**（不泄露存在性）。
- 未登录访问 `/my`：307 跳转 `/login`（实测）。
- 路由守卫覆盖：`teams/[teamSlug]`、`.../settings`、`.../projects/[projectSlug]`、
  `.../tasks/[taskId]`、`.../projects/new`、`my/projects/[projectSlug]`、`my/tasks/[taskId]`
  均在 team/membership/project/task 缺失时 `notFound()`。

### 5.3 表单中文校验（实测）

- 登录空提交 → “请输入用户名”“请输入密码”；错误密码 → “用户名或密码错误”。
- 注册空提交 → “请输入用户名”“请输入密码”“请再次输入密码”；两次密码不一致 → “两次输入的密码不一致”。
- 新建个人项目空提交 → “请输入项目名称”。
- 新建任务空提交 → “请输入任务标题”。
- 团队改名空提交 → “请输入团队名称”。
- 邀请无效 UID（`zzzzzz`）→ “UID 无效”。

### 5.4 乐观更新回滚核对

结论：**未发现回滚缺陷**。

- `apps/web/src/features/personal/tasks/components/PersonalKanban.tsx`（约 297-333 行）：
  拖拽先乐观改列，`!result.ok` 与 catch 两路都恢复 `previousStatus` 并 `message.error`。
- `apps/web/src/features/tasks/components/TeamKanban.tsx`（约 412-442 行）：同上，且失败路径完整。
- `apps/web/src/components/ui/task-detail/TaskDetailView.tsx`：
  状态切换（`previous` + catch 回滚）、子任务勾选/新增/删除（`previous` 快照回滚）、
  责任人改派（失败回滚并提示）；删除失败停留当前页并提示。

## 6. 验证结果

- `pnpm -r typecheck`：通过（packages/types、apps/web 均 Done）。
- `pnpm -r lint`：0 error；1 个**既有** warning（`features/teams/invites/service.ts:224` `inviteRow` 未使用，不在本次改动范围）。
- 全量 Vitest（`TEST_DATABASE_URL=...open_doing_test pnpm test`）：**33 个文件 / 297 个测试全部通过**。
- Playwright e2e（`pnpm --filter @open-doing/web test:e2e`）：**5/5 通过**；
  `open_doing` / `open_doing_test` 行数前后一致，隔离守卫通过（e2e 只使用 `open_doing_e2e`）。

## 7. 遗留风险

1. docker compose `web`（:3000）对 `/my` 的旧路由缓存未清理（其余页面正常）；需重建/重启容器验证一次，
   本任务按约束未操作容器。
2. 开发库角色是本次用 SQL 修正的；重新初始化环境时请直接执行已提交的 seed（`bacb8ef` 之后），
   否则会再次出现林夏/周牧角色颠倒。
3. 无路由级 loading/error 边界（O-14）；无 seed 邀请/通知，相关模块只能验证空态（O-15）。
4. 个人空间侧栏“＋”与 `/my` 页头“＋ 新建个人项目”并存；e2e 仍按 `新建项目` 精确匹配侧栏入口，
   若日后调整按钮文案需同步检查 `apps/web/e2e/utils/flows.ts:63`（本任务未改 e2e）。
