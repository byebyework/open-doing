# Open Doing 设计原型

静态 HTML 原型，浏览器直接打开 `index.html` 即可（建议宽度 1440）。

- 设计语言来源：[`../design/`](../design/)（Canva 风格设计系统：紫青渐变、白色画布、12px 软圆角、柔和冷调阴影）
- 功能依据：[2026-10-21-open-doing-v1-design.md](../2026-10-21-open-doing-v1-design.md)
- 技术落地目标：Next.js 16 + **shadcn/ui**（Radix + Tailwind CSS 4）（见 [ARCHITECTURE.md](../ARCHITECTURE.md) 4.1 节）

## 页面清单

| # | 文件 | 对应路由 | 说明 |
|---|---|---|---|
| — | `index.html` | — | 原型导航页 |
| 01 | `login.html` | `/login` | 品牌侧栏 + 用户名密码登录 |
| 02 | `register.html` | `/register` | 注册；说明 `doing_xxxx` UID 自动生成 |
| 03 | `my-tasks.html` | `/space/personal/dashboard`（v1.1） | 个人任务（含个人项目归属）+ 我负责的团队任务；**空间切换器**（个人空间 / 我的团队 / 创建团队）；侧栏个人项目分组、新建项目/任务弹窗、通知 popover（v1.1 后侧栏改为五模块，个人 Dashboard 形态以 12 为准） |
| 04 | `personal-project.html` | `/space/personal/projects/[slug]` | 个人项目列表视图（仅本人可见，无责任人列）+ 筛选排序 + 新建任务弹窗 |
| 05 | `personal-project-board.html` | `/space/personal/projects/[slug]`（看板） | 个人项目看板视图，可实际拖放卡片（演示态，刷新还原） |
| 06 | `team-overview.html` | `/space/[slug]/dashboard`（v1.1） | 项目健康度、风险区、成员负载（主管只读；v1.1 形态以 13 为准） |
| 07 | `project-list.html` | `/space/[slug]/projects/[slug]` | 团队项目列表视图 + 筛选排序 + 新建任务弹窗 |
| 08 | `project-board.html` | `/space/[slug]/projects/[slug]`（看板） | 团队项目看板视图，可实际拖放卡片（演示态，刷新还原） |
| 09 | `task-detail.html` | `/space/personal/tasks/[id]`（个人）/ `/space/[slug]/projects/[projectSlug]/tasks/[id]`（团队） | 子任务勾选实时联动进度、评论流、权限提示 |
| 10 | `invites.html` | `/invites` | UID 邀请的接受/拒绝与历史 |
| 11 | `team-settings.html` | `/space/[slug]/settings` | 团队信息、UID 邀请、成员角色、危险操作二次确认 |
| 12 | `space-dashboard-personal.html` | `/space/personal/dashboard`（v1.1） | 统计卡 + 「今天」任务列表（个人 + 指派给我的团队任务，逾期置顶、行内勾选）；**v1.1 新 IA 侧栏**：空间切换器 + Dashboard/Kanban/Calendar/Analysis/设置五模块 |
| 13 | `space-dashboard-team.html` | `/space/[slug]/dashboard`（v1.1） | 项目健康度 + 重要节点（未完成任务按截止升序前 10，含逾期）+ 成员负载；未指派引导移交 Kanban |
| 14 | `space-kanban-personal.html` | `/space/personal/kanban`（v1.1） | 空间级看板：全部个人任务跨项目聚合三列；卡片标项目归属 + 截止 + 子任务进度；按项目筛选 |
| 15 | `space-kanban-team.html` | `/space/[slug]/kanban`（v1.1） | 空间级看板：团队全部任务聚合；卡片标项目归属 + 负责人（未指派显式标注）；项目筛选 + 未指派筛选；done 列只显示近 7 天完成 |

示例数据：当前用户林夏（`doing_x7k2m9`，管理员），团队「增长突击队」（团队项目 3 个），个人项目「学习成长 / 生活琐事」，基准日期 2026-10-21。

**空间切换（v1.1）**：侧栏顶部切换器包含「个人空间」、「我的团队」列表和「创建团队 / 凭码加入」入口。切换即路由级的空间上下文切换：选中空间后侧栏展示该空间的 Dashboard / Kanban / Calendar / Analysis / 设置五模块（`/space/{spaceRef}/{module}`）。个人项目仅本人可见，与团队项目相互独立，其任务同样汇总到个人 Dashboard 的「今天」列表。

## 文件结构

```
assets/
├── design-tokens.css   三层令牌：primitive → semantic → component
├── prototype.css       共享组件样式（原型专用，生产由 shadcn/ui + Tailwind 还原）
└── prototype.js        最小交互：popover/弹窗（Radix 语义）、子任务进度联动、看板拖放、toast
```

## 设计令牌摘要（完整定义见 `assets/design-tokens.css`）

令牌为三层结构：**primitive → semantic（shadcn 槽位）→ component**。语义层采用 shadcn/ui 的标准变量名，生产直接落 `@theme`。

**primitive（品牌与中性色）**

| 令牌 | 值 | 用途 |
|---|---|---|
| `--purple-600` / `--purple-700` | `#7d2ae8` / `#6815d4` | 品牌主色 / 悬停 |
| `--purple-100` / `--purple-16` | `#eef0fc` / `rgba(125,42,232,.16)` | 选中浅底 / focus ring |
| `--cyan-500` | `#00c4cc` | 渐变终点色 |
| `--ink-900 / 700 / 500 / 400` | `#0e1318 / #3c4043 / #5f6368 / #9aa0a6` | 主/次/弱/占位文本 |
| `--surface-white / subtle / inset / cool` | `#ffffff / #f4f5f7 / #e8eaed / #eef0fc` | 卡片 / 应用底 / 凹入 / 紫浅底 |
| `--border-default / strong` | `#e1e3e6 / #c7cdd3` | 常规描边 / 悬停描边 |
| `--success-500 / warning-500 / error-500 / info-500` | `#00b894 / #ffb020 / #ff5757 / #0d99ff` | 完成、临期、逾期/错误、信息 |

**semantic（shadcn 槽位）**：`--background`=`#f4f5f7`、`--card`/`--popover`=`#fff`、`--primary`=`--purple-600`、`--muted-foreground`=`--ink-500`、`--accent`=`--surface-cool`、`--destructive`=`--error-500`、`--border`/`--input`=`#e1e3e6`、`--ring`=`--purple-600`；扩展 `--primary-hover`、`--text-secondary`、`--brand-gradient`（135deg `#7d2ae8→#00c4cc`，仅 Logo / 认证 CTA / 空状态引导）、`--success/--warning/--error/--info` 及各自 `-bg`、任务状态组 `--status-todo/progress/done/overdue/due-soon`（未开始=中性灰；进行中=品牌紫；已完成=成功绿；逾期=错误红；临期=警告黄）。

**圆角 / 阴影 / 间距**：`--radius` 系 8px（sm 6 / md 8 / lg 12 / xl 16 / pill 9999）；`--shadow-rest` `0 1px 3px rgba(14,19,24,.04)`、`--shadow-card-hover` `0 8px 24px rgba(14,19,24,.08)` + 上浮 2px、弹层 `--shadow-popover` / `--shadow-modal`；间距为 4 的倍数（`--space-1…8` = 4/8/12/16/24/32/48/64）。

**字体**：`--font-sans` = `"Canva Sans","YS Text",system-ui,-apple-system,"PingFang SC","Microsoft YaHei",sans-serif`；字重对比 800/700/600/400，正文 `--text-base` 14px / 1.5。

### 到 shadcn/ui + Tailwind CSS 4 的映射（生产接入依据）

| 原型令牌 | 生产落位 |
|---|---|
| 语义槽位（`--background` / `--primary` / `--ring` / `--radius` 等） | `@theme` 内同名 CSS 变量，shadcn 组件直接消费 |
| `--purple-600` `#7d2ae8` | `--primary` + Tailwind `primary` 色阶 |
| `--success-500 / warning-500 / error-500 / info-500` | 语义扩展变量（shadcn 标准 schema 外的扩展位） |
| `--radius-8 / --radius-12` | `--radius` / `--radius-lg`（shadcn 圆角标度） |
| `--input-height: 38px` | input 组件 token（`h-9` 对齐或自定义高度变量） |
| `--shadow-rest / --shadow-card-hover` | `shadow-xs` / `shadow-md` 级别的自定义 shadow token |
| `--brand-gradient` | 不进主题，仅 Logo 与认证 CTA（自定义 className） |
| 任务状态 `--status-*` | 状态 Badge 的语义色 + 浅色底变体 |

动效：shadcn/Radix 组件动效通过 `data-state` 过渡对齐 `--duration-*` / `--ease-*` 档位。

## 动效规范（motion）

人格：**Corporate——干净、克制、专业**，保留 Canva 的友好几何感；不使用弹跳过冲。

- 签名缓动：`cubic-bezier(0.4, 0, 0.2, 1)`，覆盖 80% 场景
- 时长档位：微反馈 120ms（按压、勾选）/ 悬停 180ms / 卡片 220ms / 弹层 280ms / 侧栏等大面板 420ms
- 方向规则：入场减速曲线（`cubic-bezier(0,0,.2,1)`，位移 12px + 淡入），退场加速曲线；弹窗 `scale .98→1 + 14px 上移`，280ms
- 列表/卡片：错峰入场间隔 30ms，总错峰 ≤180ms（遵循 <500ms 预算）
- 卡片悬停：`translateY(-2px)` + 阴影加深，单一 transition 180–220ms
- 看板：拖起时轻微缩小降透明度 + 1.5° 旋转，目标列虚线轮廓提示
- 进度条宽度变化：420ms 减速，仅宽度可线性过渡
- 全站遵循 `prefers-reduced-motion`（已在 prototype.css 中降级）
- 生产建议：页面切换用 View Transitions 或 framer-motion 实现同口径位移+淡入；shadcn/Radix 组件动效通过 `data-state` 过渡对齐时长档位

## 交互状态覆盖

原型在相应页面展示了：default / hover / focus（紫色 3px ring）/ active（scale .98）/ disabled / loading（按钮态生产补齐）/ 表单校验错误（register）/ 空状态（生产页面实现）/ 未读通知 / 拖拽（看板）/ 勾选联动（详情页）。

## 还原要求（交给前端实现时）

1. 先冻结本目录令牌，再映射到 shadcn/ui 的 `@theme` 变量与 Tailwind 变量；Tailwind 关闭 preflight。
2. 页面保持 RSC 取数，Radix/shadcn 交互组件下沉到 `"use client"` 组件。
3. 不引入原型之外的配色（尤其不要暖色米/桃底）；分类点缀色只用于头像/标签等元数据。
4. 桌面端优先，断点行为参考 prototype.css 末尾媒体查询；不以三张固定截图替代响应式。

## DOM 变更登记（shadcn 重锚期间）

重锚以「DOM 结构不变」为默认；以下为白名单内的新增元素，逐项登记：

- （无）Task 4（callout→alert）：各页 alert 的 icon 元素（如 `<span>ℹ</span>`)在旧原型中已存在，无需新增；`alert-icon` 白名单项未使用。
- Task 6（modal→dialog）：5 个弹窗各新增右上角关闭钮 `<button class="dialog-close" type="button" data-modal-close aria-label="关闭">×</button>`：my-tasks.html（新建个人项目、新建任务）、personal-project.html（新建任务）、project-list.html（新建任务）、team-settings.html（解散团队）。
- Task 8（状态规格演示）：index.html 尾部新增「状态规格演示」卡片（loading 按钮 / skeleton / toast 触发 / focus ring 输入框），为导航页允许的新增演示内容。

**验收**：2026-11-02，基准 `09b731d` — grep 契约零命中、20 页可见文案仅上述白名单差异、6 个代表页与基线并排对比像素级一致。
