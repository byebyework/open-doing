# 任务列表操作列 + 任务优先级 + 全站绝对日期 设计文档

日期:2026-11-11 · 状态:已确认(原型已获批准)

## 背景与意图

项目详情页的任务列表把全部行内操作藏在「⋯」下拉里,操作不可发现;任务缺少优先级维度,无法表达「先做哪个」;日期显示用 `MM-DD` 短格式和「今天/明天」相对文案,跨年归档后信息不完整。本轮把三件事一起落地:

1. **操作列**:列表行尾显式「操作」列(编辑 + 删除),状态切换归位到「状态」列徽标(点击弹三态菜单),替代「⋯」下拉。
2. **任务优先级**:新字段 低/中/高,新建默认「中」,贯穿表单、列表、详情、看板。
3. **全站绝对日期**:所有时间显示为 `YYYY-MM-DD`(时间戳 `YYYY-MM-DD HH:mm`),不再出现「今天/明天」相对日期文案。

原型基准:6 个已改原型(2026-11-11,本轮唯一视觉依据)。

## 目标 / 非目标

**目标**
- 个人项目列表与团队项目列表的行为、结构一致(同一套交互模式)。
- 优先级成为任务的一等字段:可存、可设、可展示、可排序。
- 全站不再渲染 `MM-DD` 短格式或相对日期文案。

**非目标**
- 不加优先级筛选(状态筛选保持唯一筛选)。
- 看板不按优先级自动排序,列内拖拽行为不变。
- 不动 Dashboard 模块的统计口径与布局(日期格式随全局走,仅此而已)。
- 日历「今天」按钮 / 今日徽标、统计卡文案(「今日 / 明日到期」「本周已完成」)、日历星期表头、`基准日期` 说明行:全部保留(导航/语义控件,非日期展示)。
- 不做优先级的颜色自定义或第四档(紧急)。

## 已定决策

| # | 决策 | 理由 |
|---|------|------|
| D1 | 操作列 = 编辑(铅笔)+ 删除(垃圾桶)两个图标按钮;删除仅 `canDeleteTask` 为真时渲染,编辑恒显(进详情页,成员只读) | 与既有权限模型一致 |
| D2 | 状态列徽标变为可点:点击弹三态菜单(未开始/进行中/已完成,当前态高亮);无编辑权时徽标禁用 | 状态操作语义归位;菜单优于循环切换(避免连点跨态) |
| D3 | 优先级三档 `low / medium / high`,默认 `medium`,必选 | 与原型一致 |
| D4 | DB:`tasks.priority text NOT NULL DEFAULT 'medium'`;`packages/types` 增加 `TaskPriority` 联合类型与 `TASK_PRIORITY_ORDER`(low<medium<high);不建索引(列表排序在 JS 层,数据量小) | 迁移可回放,存量任务自动「中」 |
| D5 | 列表列序:任务 / **优先级**(72px,色点+文字:高红·中黄·低灰)/ 状态 / (责任人) / 进度 / 截止日期 / 操作 | 原型 A 方案 |
| D6 | 「排序」下拉增加「按优先级（高→低）」:高→低,同优先级按截止日期升序、无日期靠后,最终平局按创建时间(既有尾序保留);默认排序仍为按截止日期。**两个列表原型的排序控件已补该选项(2026-11-11)** | builder check 指出原型缺失,用户确认补原型 |
| D7 | 新建/编辑表单加「优先级」下拉(必选,默认中),覆盖**四个**入口:个人 `NewTaskModal`、团队 `NewTeamTaskModal`、个人 Dashboard 的 `features/dashboard/my-tasks/components/NewTaskModal.tsx`、详情页编辑;详情页编辑是**共享组件** `src/components/ui/task-detail/TaskDetailView.tsx`(个人/团队 wrapper 共用),优先级行与编辑只改这一处 | builder check 补全 |
| D8 | 详情页元信息加「优先级」行(状态行之后),可编辑;该页的日期渲染同时按 D10/D11 改为绝对日期 | 原型 task-detail.html |
| D9 | 看板卡片底部加优先级色点(仅色点,悬停 title 显示档位文字),覆盖 `PersonalKanban` / `TeamKanban` / **空间级看板 `SpaceKanban`** | 原型三个 board(空间级看板原型同步) |
| D10 | `DueText` 重写:一律显示 `YYYY-MM-DD`;逾期红(文案「已逾期 · YYYY-MM-DD」)、临期黄(仅日期,无「今天/明天」字样)、普通灰;`title` 属性保留完整日期 | 用户确认「全部用绝对日期」 |
| D11 | **绝对日期全站彻底改**(用户确认,含 builder check 盘点出的全部面):① 各处本地 `shortDate`(共 6 份:DueText、TaskDetailView、SpaceKanban、TodayTaskList、MilestoneList、SpaceCalendar)收敛为一个共享纯函数,统一输出 `YYYY-MM-DD`;② 时间戳 `MM-DD HH:mm` → `YYYY-MM-DD HH:mm`:邀请页、团队设置页(含 `MemberList` joinedAt、`JoinRequestList`)、`CommentBox` 评论时间;③ Dashboard `TodayTaskList` 的「今天到期」徽标改为完整日期(徽标样式保留);④ 分析页 `buckets.ts` / `SpaceAnalysis` 图表轴标签与悬浮文案改完整日期;⑤ 通知模板**保持「今日/明日」措辞不变**(语义化文案而非日期展示,原型通知体亦无日期;builder check 确认模板无日期占位符,D11 原模板条款作废);`NotificationBell` 的 `fromNow()` 相对时间保留(与原型一致) | 用户确认「全站所有时间」 |
| D12 | 优先级校验:service 层拒绝 `low/medium/high` 之外的值(DomainError,field=priority);更新时未传 priority 则不改;typed `Task` 夹具(`TeamKanban.test.ts` 的 `makeTask` 等)同步补字段 | 与 status 校验同型 |
| D13 | i18n:`tasks` ns 新增 `priority` 标签、`priorityLow/Medium/High`、`sortPriority`、操作列相关 key;移除孤儿 key `tasks.markAs`、`tasks.rowActionsAria`(zh/en 同步);`date.today` / `date.tomorrow` 保留(TaskDetailView / SpaceCalendar 改造后若无人用则删) | cjk-guard / messages-parity 必须绿 |
| D14 | 既有 `RowActions` 文件不删除:两个文件重构为「操作列组件」(编辑/删除图标),下拉实现移除;`TASK_STATUS_ORDER` / `TASK_STATUS_KEYS` / `ProjectTask` / `TaskStatusButtons` / `PersonalProjectPageActions` 等共享导出留在原文件,看板既有引用不动 | builder check:多导出枢纽,删除成本高 |

## 约束

- 冻结契约不碰:`AppShell`、`(dashboard)/layout.tsx` import 关系。
- 所有 Server Action 独立鉴权;优先级修改走既有 `updatePersonalTaskAction` / `updateTeamTaskAction` 的权限链,不新增 action。
- UI 文案全部进 zh/en 目录;日期一律 dayjs + Asia/Shanghai 口径,不使用本地时区。
- 迁移用 `pnpm db:generate` 生成,空库可重放。

## 留给实现者的

- 组件拆分方式(优先级 chip / 色点是否抽公共组件)由实现者定,但须同时服务列表与看板。
- e2e 需同步改的断言:flow 07(日历侧栏 `今天 · 周X MM-DD` 标签 → 完整日期)、flow 08(分析悬浮 `今天 · 完成 N` → 完整日期);新增优先级/操作列断言可并入既有 flow;e2e 中新表单文案如需断言,记得 cjk-guard 的 e2e 白名单。
- 测试优先级排序比较函数与表单校验的具体用例切分。
- 零散创建路径(种子脚本、DB 测试夹具)不传 priority,由列默认值 `medium` 兜底,无需逐一修改。

## 验收清单

1. 个人/团队项目列表:无「⋯」下拉;操作列两图标;徽标点击弹三态菜单;权限禁用/隐藏正确。
2. 四个创建/编辑入口均含优先级且默认「中」;详情页可改优先级。
3. 列表按「优先级」排序:高→低、同级按截止日期、无日期最后、最终按创建时间。
4. 三个看板(Personal/Team/Space)卡片显示优先级色点。
5. 全站日期扫描:`grep -rn 'MM-DD' apps/web/src` 无格式化调用残留;六个 `shortDate` 定义收敛;`DueText` 不再渲染「今天/明天」;e2e 07/08 绿。
6. `pnpm lint` / `pnpm test` / `pnpm typecheck`(先 typegen)/ 相关 e2e 全绿。
