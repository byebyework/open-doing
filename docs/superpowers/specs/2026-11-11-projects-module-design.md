# 项目模块(空间级项目列表)设计

日期:2026-11-11
原型:`docs/prototypes/space-projects-team.html`、`docs/prototypes/space-projects-personal.html`(README 页面清单 16/17,v1.2)

## 背景与动机

v1.1 的信息架构把登录后导航收敛为 Dashboard / Kanban / Calendar / Analysis / 设置五个模块,项目在这一步失去了导航入口:`/space/{ref}/projects` 列表页从未实现,项目详情页只能经其他页面的链接到达,实际使用中"找不到项目"。原型 `project-list.html` 名不副实(实为项目详情页),整个原型集没有覆盖项目列表页。

项目是本系统"团队 → 项目 → 任务"层级的中间层,属于高频浏览对象。本次将其升级为正式空间模块。

## 目标

1. 「项目」成为正式空间模块:个人空间与团队空间各有一个列表页
   - `/space/personal/projects`(个人项目)
   - `/space/[teamSlug]/projects`(团队项目)
2. 侧边栏新增「项目」入口,位置在 Dashboard 与 Kanban 之间;模块顺序变为
   Dashboard → 项目 → Kanban → Calendar → Analysis → 设置。
3. 列表页主体为项目卡片网格,每张卡片展示(与原型 16/17 一致):
   - 项目名称、描述(两行截断)
   - 进度条 + 百分比(任务进度等权平均,空项目 0%,口径同 `getTaskProgress` 聚合)
   - 任务数 · 已完成数;逾期任务数 > 0 时追加「· 逾期 N」
   - 健康徽标:**已逾期**(有逾期任务)/ **临期**(无逾期但有今日或明日截止)/ **正常**——与 Dashboard「项目健康度」(`ProjectHealth.hasOverdue / hasDueSoon`)同口径;个人空间用同一套规则
   - 进度条颜色随健康度:逾期红 / 临期黄 / 正常绿(未开始 0% 用默认灰,徽标显「未开始」)
4. 团队空间:owner/admin 可见「新建项目」入口(走现有 `/space/[teamSlug]/projects/new` 表单页);member 只读。卡片点击进现有详情页 `/space/[teamSlug]/projects/[projectSlug]`。
   - 注意:列表页的「团队整体进度」为**按项目等权平均**(§7 口径),与 Dashboard 当前实现(任务级平均)数值可能不同,属已知差异,不在本轮修复。
5. 个人空间:「新建项目」打开现有 `PersonalProjectFormModal`(复用 `NewPersonalProjectButton` 能力);卡片点击进 `/space/personal/projects/[projectSlug]`。
6. 页面顶部摘要行:团队显示「N 个项目 · 整体进度 P%(按项目等权平均)」(与 Dashboard「团队整体进度」同源);个人显示「N 个个人项目」。两者都注明排序口径。

## 非目标(本轮不做)

- 列表筛选、排序切换、项目归档
- 侧边栏常用/最近项目直达
- 项目级成员管理、项目封面/颜色定制
- 修改任何 v1.1 冻结原型与现有项目详情页、看板

## 反目标(出现即算失败)

- 硬编码用户文案(必须进 zh/en catalog,过 cjk-guard 与 messages-parity)
- 绕过 Server Action 授权:member 也能调创建 action(现有 `createTeamProject` 已按 `team:manage_projects` 校验,不得削弱)
- 组件内本地时区取"今天"(必须沿用 `lib/today.ts` + RSC 传 `today` prop 的约定)
- 绕过 token 体系引入新色值

## 约束

- 冻结契约(`AppShell`、`(dashboard)/layout.tsx` import 关系)不动。
- `SpaceModule` 类型(`apps/web/src/lib/routes.ts`)扩展 `"projects"` 后,`moduleHref` 及侧栏导航(`components/layout/SpaceNavMenu.tsx`)随之更新;`routes.test.ts` 同步。
- 服务端数据查询必须带可见性过滤:团队项目要求成员身份(现有 `listTeamProjects` 已保证),个人项目仅本人(现有 `listPersonalProjects` 已保证)。
- 健康徽标不得新造口径:复用/抽取 `features/dashboard/team-overview/service.ts` 中已有的单项目健康度判定(同一套"今天=Asia/Shanghai"规则)。团队整体进度按产品文档 §7 的「项目等权平均」实现,但不改动 Dashboard 现有的任务级平均。
- UI 用 vendored shadcn/ui + token 变量;动画走 Motion;新页面按原型 16/17 还原。

## 已拍板的决定

| 决定 | 结论 |
|---|---|
| 列表页 vs 侧栏平铺 | 列表页为主,侧栏只加一个「项目」模块入口 |
| 侧栏位置 | Dashboard 与 Kanban 之间 |
| 团队整体进度口径 | **按项目等权平均**(产品文档 §7 定义;含空项目 0%)——Dashboard 现状为任务级平均,与 §7 不一致,本轮不动 Dashboard,差异记为后续统一 issue |
| 卡片健康徽标优先级 | 已逾期 > 临期 > 未开始(progress = 0 且无逾期/临期)> 正常;进度条颜色跟随徽标,未开始用默认灰 |
| 排序 | 固定按创建时间升序(两个空间一致);仅列表页使用该排序,`listPersonalProjects` 现有调用方(日历/看板/详情页)的排序不受影响 |
| 团队整体进度展示 | 摘要行注明「按项目等权平均」 |
| 新建团队项目 | 跳现有 `/projects/new` 表单页,不做弹窗 |
| 新建个人项目 | 弹窗(复用 `PersonalProjectFormModal`) |
| 个人卡片是否带徽标 | 带,规则与团队相同(个人任务同样可逾期/临期) |

## 交给 builder 的部分

- **聚合查询**:为列表页取每个项目的 `{ progress, taskCount, doneCount, overdueCount, dueSoonCount }`。建议在 `features/projects` / `features/personal/projects` 各自的 service 内实现(或从 team-overview 抽取共享的纯计算函数放入合适层级),由 builder 按现有分层习惯定,要求:不跨 feature 私拿数据、可单测、`today` 由调用方注入。
- 组件拆分(卡片、网格、摘要行的 client/RSC 边界,按"页面 RSC + 交互下沉 client"的既有约定)。
- i18n key 命名(`projects` 命名空间,含健康徽标、摘要行、空状态文案,zh/en 同步)。
- 空状态(无任何项目时)的形态——原型未覆盖,按 `EmptyState` 组件与既有空状态文案风格处理。
- 测试范围:service 聚合单测、`routes.test.ts`、必要的组件测试;是否新增 e2e flow 由 builder 在计划中提出。

## 验收清单

1. 登录后任一空间侧栏可见「项目」入口,两空间列表页可达,卡片数据与 Dashboard 健康度一致。
2. 团队 member 看不到「新建项目」,直接调 action 被 403;owner/admin 可创建并在新项目出现在列表首位之外的位置(按创建时间排序验证)。
3. 个人空间新建个人项目后列表即时反映(`router.refresh`)。
4. `pnpm lint` / `pnpm test` / `pnpm typecheck`(先生成路由类型)通过;cjk-guard、messages-parity 绿。
5. v1.1 既有 15 个原型文件与五个既有模块页面无 diff。
