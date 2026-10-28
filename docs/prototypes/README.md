# Open Doing 设计原型

静态 HTML 原型，浏览器直接打开 `index.html` 即可（建议宽度 1440）。

- 设计语言来源：[`../design/`](../design/)（Canva 风格设计系统：紫青渐变、白色画布、12px 软圆角、柔和冷调阴影）
- 功能依据：[2026-10-21-open-doing-v1-design.md](../2026-10-21-open-doing-v1-design.md)
- 技术落地目标：Next.js 16 + **Ant Design v6** + Tailwind CSS 4（见 [ARCHITECTURE.md](../ARCHITECTURE.md) 4.1 节）

## 页面清单

| # | 文件 | 对应路由 | 说明 |
|---|---|---|---|
| — | `index.html` | — | 原型导航页 |
| 01 | `login.html` | `/login` | 品牌侧栏 + 用户名密码登录 |
| 02 | `register.html` | `/register` | 注册；说明 `doing_xxxx` UID 自动生成 |
| 03 | `my-tasks.html` | `/my` | 个人任务（含个人项目归属）+ 我负责的团队任务；**空间切换器**（个人空间 / 我的团队 / 创建团队）；侧栏个人项目分组、新建项目/任务弹窗、通知 popover |
| 04 | `personal-project.html` | `/my/projects/[slug]` | 个人项目列表视图（仅本人可见，无责任人列）+ 筛选排序 + 新建任务弹窗 |
| 05 | `personal-project-board.html` | 同上 | 个人项目看板视图，可实际拖放卡片（演示态，刷新还原） |
| 06 | `team-overview.html` | `/teams/[slug]` | 项目健康度、风险区、成员负载（主管只读） |
| 07 | `project-list.html` | `…/projects/[slug]` | 团队项目列表视图 + 筛选排序 + 新建任务弹窗 |
| 08 | `project-board.html` | 同上 | 团队项目看板视图，可实际拖放卡片（演示态，刷新还原） |
| 09 | `task-detail.html` | `…/tasks/[id]` | 子任务勾选实时联动进度、评论流、权限提示 |
| 10 | `invites.html` | `/invites` | UID 邀请的接受/拒绝与历史 |
| 11 | `team-settings.html` | `…/settings` | 团队信息、UID 邀请、成员角色、危险操作二次确认 |
| 12 | `space-dashboard-personal.html` | `/space/personal/dashboard`（v1.1） | 统计卡 + 「今天」任务列表（个人 + 指派给我的团队任务，逾期置顶、行内勾选）；**v1.1 新 IA 侧栏**：空间切换器 + Dashboard/Kanban/Calendar/Analysis/设置五模块 |
| 13 | `space-dashboard-team.html` | `/space/[slug]/dashboard`（v1.1） | 项目健康度 + 重要节点（未完成任务按截止升序前 10，含逾期）+ 成员负载；未指派引导移交 Kanban |

示例数据：当前用户林夏（`doing_x7k2m9`，管理员），团队「增长突击队」（团队项目 3 个），个人项目「学习成长 / 生活琐事」，基准日期 2026-10-21。

**空间切换**：侧栏顶部切换器包含「个人空间」（对应"我的任务"页，侧栏显示个人项目分组、隐藏团队导航）、「我的团队」列表（打勾为当前空间，选中后显示团队概览/项目/设置）和「创建团队」入口。切换本质是路由级的空间上下文切换。个人空间内可创建个人项目（仅本人可见，与团队项目相互独立，项目内任务同样汇总到「我的任务」）。

## 文件结构

```
assets/
├── design-tokens.css   三层令牌：primitive → semantic → component
├── prototype.css       共享组件样式（原型专用，生产由 antd + Tailwind 还原）
└── prototype.js        最小交互：popover/弹窗、子任务进度联动、看板拖放
```

## 设计令牌摘要（完整定义见 `assets/design-tokens.css`）

**品牌与语义色**

| 令牌 | 值 | 用途 |
|---|---|---|
| `--color-primary` | `#7d2ae8` | 主按钮、链接、选中态、进度条 |
| `--color-primary-hover` | `#6815d4` | 主按钮悬停 |
| `--color-brand-gradient` | `135deg #7d2ae8 → #00c4cc` | 仅品牌时刻：Logo、认证页 CTA、空状态引导 |
| `--color-bg / surface` | `#f4f5f7 / #fff` | 应用底色 / 卡片 |
| `--color-text` 系列 | `#0e1318 / #3c4043 / #5f6368 / #9aa0a6` | 主/次/弱/占位文本 |
| `--color-border` | `#e1e3e6` | 卡片、表格、输入框描边 |
| success / warning / error / info | `#00b894 / #ffb020 / #ff5757 / #0d99ff` | 完成、临期、逾期/错误、信息 |

**任务状态配色**：未开始=中性灰；进行中=品牌紫（底 `#eef0fc`）；已完成=成功绿；逾期=错误红；临期=警告黄。

**圆角 / 阴影 / 间距**：按钮与输入 8px、卡片 12px、大面板 16px、胶囊 9999px；卡片静止阴影 `0 1px 3px rgba(14,19,24,.04)`，悬停 `0 8px 24px rgba(14,19,24,.08)` + 上浮 2px；间距为 4 的倍数（4/8/12/16/24/32/48/64）。

**字体**：`"Canva Sans","YS Text",system-ui,-apple-system,"PingFang SC","Microsoft YaHei",sans-serif`；字重对比 800/700/600/400，正文 14px / 1.5。

### 到 antd v6 ConfigProvider 的映射（生产接入依据）

| Token（antd v6） | 值 |
|---|---|
| `colorPrimary` | `#7d2ae8` |
| `colorSuccess / colorWarning / colorError / colorInfo` | `#00b894 / #ffb020 / #ff5757 / #0d99ff` |
| `colorBgLayout` | `#f4f5f7` |
| `colorBorder` / `colorBorderSecondary` | `#c7cdd3` / `#e1e3e6` |
| `borderRadius` / `borderRadiusLG` | `8` / `12` |
| `fontFamily` | 上方字体栈 |
| `boxShadow` / `boxShadowSecondary` | `0 1px 3px rgba(14,19,24,.04)` / `0 8px 24px rgba(14,19,24,.08)` |
| `controlHeight` | `38`（输入/按钮高度对齐原型） |

品牌渐变不进 antd 主题，仅用在 Logo 与认证 CTA（自定义 className）。状态 Tag 用语义色 + 浅色底的预设/自定义 token。

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
- 生产建议：页面切换用 View Transitions 或 framer-motion 实现同口径位移+淡入；antd 组件动效通过 `motion*` token 对齐时长

## 交互状态覆盖

原型在相应页面展示了：default / hover / focus（紫色 3px ring）/ active（scale .98）/ disabled / loading（按钮态生产补齐）/ 表单校验错误（register）/ 空状态（生产页面实现）/ 未读通知 / 拖拽（看板）/ 勾选联动（详情页）。

## 还原要求（交给前端实现时）

1. 先冻结本目录令牌，再映射到 antd ConfigProvider 与 Tailwind 变量；Tailwind 关闭 preflight。
2. 页面保持 RSC 取数，antd 交互组件下沉到 `"use client"` 组件。
3. 不引入原型之外的配色（尤其不要暖色米/桃底）；分类点缀色只用于头像/标签等元数据。
4. 桌面端优先，断点行为参考 prototype.css 末尾媒体查询；不以三张固定截图替代响应式。
