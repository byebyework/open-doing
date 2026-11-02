# antd → shadcn/ui 迁移设计(open-doing web)

日期:2026-11-02
状态:待用户确认
前置:`docs/superpowers/specs/2026-11-02-shadcn-prototype-reanchor-design.md`(原型重锚,已完成并合并,main @ 3d41dfb)

## 意图与为什么

把 `apps/web` 的 UI 组件库从 antd v6 迁移到 shadcn/ui。动因(用户原话):

1. shadcn/ui 组件代码平铺在仓库里,vibecoding 时代 agent 更容易读懂和修改;
2. 更适配纯 CSS / Tailwind 的样式体系,摆脱 antd 的样式黑盒。

原型已重锚到 shadcn 词汇并验收(main @ 3d41dfb),`docs/prototypes/` 是本次迁移的唯一视觉与文案基准。

## 目标

- 所有用户可见界面与 `docs/prototypes/` 对应页面对齐,验收线为**令牌 + 组件形态 + 文案一致**;stock shadcn/Radix 默认形态与手工原型的固有差异(弹窗动画曲线、select 箭头字形、焦点环渲染细节)不在验收范围内,不为像素一致而定制组件。
- 迁移全程可日常使用:每合并一个模块,应用完整可用、测试全绿。
- 迁移结束后 antd 及 `@ant-design/*` 依赖从 `apps/web` 完全移除。
- 既有行为不回归:权限模型、Server Action 校验流、i18n(zh/en 目录 + cjk-guard + messages-parity)、日期语义(Asia/Shanghai)全部保持。
- 看板页新增统计能力(见 Phase 0),功能诉求来自用户:进行中/已完成/待开始数量、即将到期/已逾期数量、项目进度,统计可点击即筛选。

## 非目标

- 不做原型之外的视觉再设计;布局与信息架构不因迁移改变(Phase 0 的看板统计带是唯一例外,且它先进原型)。
- 不改后端:数据库 schema、Server Action 签名、权限判断逻辑不动。唯一例外:看板查询服务层的筛选类型允许**只读扩展**(新增状态/逾期筛选能力),不改变既有签名与调用关系。
- 不做暗色模式(原型只有浅色;`theme-color`/tokens 已固定)。
- 不引入路由级代码分割优化、性能重构等无关工程。

## 反目标(什么会算失败)

- 迁移期间某一步之后应用不可用或测试长期红着。
- 出现"antd 和 shadcn 各渲染一半"长期共存却无推进计划的僵局。
- 为省事保留 antd 的 message/Modal 全局单例语义导致新旧提示风格混用。

## 用户已定的决策

| 决策 | 选择 |
|---|---|
| 看板统计先改原型还是直接进 app | 先补进冻结原型(Phase 0),保持「原型 = 唯一视觉基准」 |
| 迁移节奏 | 按模块渐进,antd 与 shadcn 共存过渡,每模块合并后全量可用 |
| 视觉验收线 | 令牌 + 组件形态 + 文案与原型一致;stock shadcn/Radix 默认差异(动画曲线、下拉箭头字形、焦点环渲染等)不追。能用原生组件就不定制样式 |

## 约束

- `AGENTS.md` 中"冻结契约(AppShell、`(dashboard)/layout.tsx` 导入关系)不得修改"是上一轮重锚时点的约束;本轮迁移必然触及 providers/AppShell/布局外壳,视为该约束对迁移模块的显式解冻,但解冻范围仅限 UI 层,路由结构与 Server Action 调用关系不变。
- 设计令牌以 `apps/web/src/app/tokens.css` 为准(与 `docs/prototypes/assets/design-tokens.css` 1:1),改名或增值必须两处同步——本轮预期零改动,直接消费。
- `fileParallelism: false` 的 Vitest、e2e 端口 3100 独立库、typecheck 前先 typegen——测试基建照旧。
- 文案零硬编码,新增组件必须带 zh/en 双目录。

## 技术映射(antd → shadcn)

| antd | shadcn / 方案 | 备注 |
|---|---|---|
| Button / Input / Checkbox / Switch | 同名 shadcn 组件 | 直接替换 |
| Form / Form.Item | react-hook-form + zod + shadcn Form 模式 | 见下方「表单策略」 |
| Modal | Dialog(原型 `.dialog` 已定形态) | 确认类弹窗统一 AlertDialog |
| message(31 处) | sonner toast(原型 Task 8 已演示 sonner 形态) | `App` context 移除 |
| Select | shadcn Select | 表单内受控 |
| Dropdown + MenuProps | DropdownMenu | Topbar/SpaceSwitcher/行操作 |
| Tag | Badge | StatusTag 内部改造 |
| Alert | Alert | 原型 `.alert` 已定形态 |
| Segmented | Tabs | |
| Popover | Popover | NotificationBell |
| Drawer | Sheet | MobileNav |
| Progress | Progress | ProgressBar 内部改造 |
| Calendar | react-day-picker | 日历页,唯一新依赖 |
| Pagination | Pagination | |
| Empty / Result | 自写空态/结果态组件 | 原型有空态样式 |
| ConfigProvider + theme.ts | tokens.css + Tailwind 主题,theme.ts 删除 | 根 Providers 重写 |
| Badge | Badge(变体) | |

新增依赖预计:`react-hook-form`、`zod`、`sonner`、`@radix-ui/*`(随 shadcn 组件)、`react-day-picker`、`date-fns`(react-day-picker 依赖,日历页日期文案需接 next-intl)。

### 表单策略(实现者的关键决策点,我的倾向已标注)

现状:客户端组件用 antd Form,提交走 Server Action,`ActionResult.errors` 映射回字段。

**我的倾向(标注为我的决策,用户可否决)**:统一迁到 react-hook-form + zod——shadcn 官方 Form 即此方案,vibecoding 友好度最高;服务端校验仍在 Server Action/服务层不动,zod schema 仅做客户端前置校验与类型,两端错误文案都走 next-intl。代价:每个表单的迁移量比纯换控件大,是各模块工作量的主要来源。

不选的替代:最小改造(受控 input + useState + 手写错误提示)——省依赖但每个表单都在重造校验轮子,长期不利。

## 实施分期

### Phase 0:看板统计原型补全(先于一切代码迁移)

修改 `docs/prototypes/space-kanban-team.html` 与 `space-kanban-personal.html`:

1. 筛选条上方(或内部)新增统计带:待开始 / 进行中 / 已完成 / 已逾期 / 即将到期(3 天内)五组数字;已逾期用危险色令牌。数字按当前筛选范围聚合,语义是"统计即筛选"——点击即应用对应过滤(已逾期→只看逾期,状态数字→状态筛选)。
   - **机制(app 侧对应实现,原型只表现行为)**:沿用 app 的 URL 驱动筛选约定,新增 `status`/`overdue` 之类 searchParam,由看板 service 的筛选类型做只读扩展承载;不用纯客户端过滤,保证可分享、可用 URL 测试。
   - **统计口径**:排除已完成任务;以 Asia/Shanghai 的"今天"为基准(复用 `lib/today.ts`);无项目筛选时统计显示当前空间全范围聚合;已完成列计数按看板现有"近 7 天完成"口径,原型文案需体现该口径。
2. 筛选条项目名旁加小型进度指示(百分比),与 Dashboard 健康度卡同源聚合口径(`getTaskProgress`)。
3. 列头保留数量,进行中列头可叠加逾期小标。
4. DOM 变更逐项登记进 `docs/prototypes/README.md`,并更新验收基准行。

原型改完用与上轮相同的对比纪律(文本 diff + 截图对比)验证后,再开代码迁移。

### Phase 1:地基

- 引入 shadcn 基建(components.json、`src/components/ui/shadcn/` 目录、tailwind 配置对齐 tokens)。
- **Tailwind preflight 共存期保持关闭**(antd 仍在渲染,全局重置风险不可控);到「清场」步骤移除 antd 后再开启,并伴随一次全局视觉审计(走查全部页面 + e2e 截图对比)。
- 根 Providers **本阶段只增不改**:在现有 antd 包裹外层挂载 sonner `<Toaster />`(共存期 antd 组件仍需 ConfigProvider 主题与 App context;ConfigProvider/AntdRegistry/dayjs locale 的移除在「清场」执行)。html lang 机制保留。
- 安装依赖,先迁 `Button`/`Badge`/`Alert`/`StatusTag`/`ProgressBar` 等原子件放在 shadcn 目录,新旧并存。
- 判定标准:全部测试绿、e2e 登录流绿、视觉无变化(令牌 1:1)。

### Phase 2:模块逐一迁移(顺序即风险从低到高)

每模块一个 PR 式提交组,完成定义:该模块页面与原型一致、该模块 antd import 清零、全量测试 + 相关 e2e 绿。

1. **auth**(LoginForm/RegisterForm + not-found)——最小试点,验证表单策略全链路。
2. **teams**(建团/改名/邀请/成员管理/解散等确认弹窗群)——弹窗模式密集,验证 Dialog/AlertDialog。
3. **personal**(my-tasks、个人项目、任务详情、评论)——表单 + 详情视图 + Drop 拖拽。
4. **users + notifications**(设置页、语言切换、通知铃)——Popover/开关。
5. **dashboard + kanban**(含 Phase 0 统计带进 app)——看板拖拽 DnD 保留现实现,只换皮。
6. **tasks/projects 团队侧**(团队任务详情、表格、新建弹窗)——最大模块,依赖前面所有组件就位。
7. **calendar**——react-day-picker,唯一有新交互实现的模块,放最后。
8. **清场**:根 Providers 重写(移除 AntdRegistry/ConfigProvider/AntApp/dayjs locale,保留 sonner Toaster 与 html lang 机制);移除 antd/@ant-design 依赖、theme.ts、ConfirmModal 等过渡壳,全仓 grep `from "antd"` 归零;开启 Tailwind preflight 并做全局视觉审计。

### 顺序理由

auth 最小可验证全链路;teams 集中验证弹窗;kanban/tasks 依赖的原子件在前几步已稳定;calendar 引入新依赖和新交互,隔离在最后降低连锁风险。

## 留给实现者的部分

- 各组件具体 API/变体选择(Button variant 映射、Dialog 尺寸)对照原型逐页落实。
- 每模块迁移时的测试增量:e2e 已覆盖主流流程,模块迁移不得要求改 e2e 断言(选择器语义不变);若断言必须改,升级为需在提交说明中记录理由。
- 拖拽实现(SpaceKanban/PersonalKanban)保持现库,仅换渲染层。
- 日期输入继续用原生 `input type=date`(原型如此),不引入 antd DatePicker 等价物。
