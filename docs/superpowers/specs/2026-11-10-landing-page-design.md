# Open Doing Landing Page 设计文档

日期:2026-11-10
状态:已经人工确认(视觉方向、整页结构、文案口径均通过 mockup 逐轮评审)

## 1. 意图与背景

Open Doing 目前没有对外落地页:未登录访客访问 `/` 会被重定向进登录/仪表盘。本次新增一个营销性质的 landing page,承担**产品功能展示 + 拉新**职责,让访客在看懂产品后进入注册/登录。

同时确立一项工程约定:**全项目动效统一基于 Motion 库(`motion` 包,motion.dev;`motion/react` 为 React 入口)实现**。现有 `apps/web/src/app/motion.css`(2026-11-07 引入的 iOS 浮层动画,基于 CSS keyframes + Radix `data-state`)一并迁移到 Motion,迁移完成后删除该文件。

## 2. 目标 / 非目标 / 反目标

**目标**
- 未登录访客打开 `/` 看到完整 landing page;已登录用户访问 `/` 仍跳转个人空间仪表盘。
- 页面展示产品四大模块(仪表盘/看板/日历/分析),配**运行中应用的真实截图**(新小鸟 logo、中文 UI、种子数据)。
- 全部文案 zh/en 双语,经 next-intl 目录下发;页面提供「中/EN」切换(匿名用户)。
- 页面动效全部用 Motion 实现;现有浮层动画迁移到 Motion。
- 遵守仓库既有约定:token 变量、shadcn/ui、RSC 优先、i18n 强制(cjk-guard / messages-parity)。

**非目标**
- 不做定价页、博客、SEO 内容矩阵(导航锚点只有:功能 / 个人 vs 团队 / 常见问题)。
- 不做暗色主题、不做登录后可见的变体。
- 不修改 `docs/prototypes/`(冻结);landing page 是新增界面,以本文档 + 已确认 mockup(`docs/superpowers/specs/2026-11-10-landing-page-mockup/landing-page-mockup.html`,含四张真实截图,浏览器直接打开)为视觉基准。

**反目标(出现即算失败)**
- 文案出现邀请码/内测门槛相关表述(已明确要求去掉)。
- 截图使用旧 "O" 字标的原型界面。
- 文案或图标使用 emoji(一律 Lucide)。
- 为动画引入 Motion 之外的新动画库,或新代码回退到手写 CSS keyframes。

## 3. 路由与鉴权

- 新增 `apps/web/src/app/page.tsx`(根路由,移出现 `(dashboard)/page.tsx` 的重定向职责;`(dashboard)/layout.tsx` 冻结契约不动,`layout.tsx` 内的 import 关系不改动):
  - `getCurrentUser()` 有会话 → `redirect(spaceDashboardHref("personal"))`;
  - 无会话 → 渲染 landing page。
- landing page 本身是 RSC;交互片段(动效容器、语言切换、FAQ 手风琴)下沉为 `"use client"` 组件,props 全部可序列化。
- 页面需通过 `getTranslations("landing")` 取文案;不引入 URL locale 前缀。

## 4. 页面结构与文案(以 mockup v4 为准)

自上而下(桌面 ≥1024px 布局;移动端全部单列堆叠,双屏拼贴改为纵向排列):

### 4.1 导航(吸顶 + 毛玻璃)
- 左:BrandMark(复用 `src/components/ui/BrandMark.tsx`,小鸟 logo)+ "Open Doing" 字标。
- 中:锚点链接 功能(#features) / 个人 vs 团队(#audiences) / 常见问题(#faq)。
- 右:「中/EN」语言切换 chip、登录(→ `/login`)、「免费开始」主按钮(→ `/register`)。

### 4.2 首屏(已选定 B 方案:左文右图拼贴)
- 左列:
  - 徽标 chip:「为小团队打造」(Lucide `target`)
  - H1:`把想法,` 换行 + 渐变文字 `变成团队的每一天`(en: "Turn ideas into / your team's every day")
  - 副文案:`个人待办与团队项目同处一个系统。看板、日历、提醒、数据分析,开箱即用。`
  - CTA:渐变主按钮「免费开始使用」+ 描边按钮「登录」
  - 信任行:`免费使用 · 开箱即用 · 个人空间与团队空间一体`
- 右列:双屏拼贴——日历截图在后(rotate 2deg)、看板截图在前(rotate −2.5deg)、左下角浮动提醒卡(Lucide `bell`,"提醒:需求评审 14:00")。两层错落漂移进场,滚动时轻微视差。

### 4.3 功能区(#features,四个模块图文左右交替)
区块引言:label「功能」+ 标题「一个入口,看清所有事」。

| 模块标签 | 标题 | 正文 | 截图 |
|---|---|---|---|
| 仪表盘 | 项目健康度,一眼见底 | 在办项目、整体进度、临期与逾期任务自动聚合;每个项目的健康状态按任务完成度实时计算,不用追问、不用催。 | dashboard |
| 看板 | 拖一下,任务就动了 | 待办、进行中、已完成三列看板,拖拽即流转;负责人、截止日、标签一目了然,团队谁在做什么,board 上见。 | kanban |
| 日历 | 截止日,不用记 | 任务按日历铺开,临期自动提醒;今天该做什么、这周压着什么,打开日历就知道。 | calendar |
| 分析 | 团队负载,数据说话 | 完成趋势、成员负载、逾期分布自动成图;周会汇报,直接投这一页。 | analysis |

模块标签用应用内的中文名(仪表盘/看板/日历/分析;en: Dashboard/Kanban/Calendar/Analysis),与截图内 UI 一致。

### 4.4 双场景区(#audiences)
引言:label「个人 vs 团队」+ 标题「一个人用得起,一群人用得开」。
- 卡 A(Lucide `user`,蓝):「独立工作者」——私人空间管理自己的待办与项目,想法不过夜;哪天拉上伙伴,邀请进团队空间即可,数据无缝延续。
- 卡 B(Lucide `users`,紫,渐变浅底):「小团队」——团队空间里按项目分工,看板协作、日历对齐、分析复盘;权限清清楚楚,成员只动自己的任务。

### 4.5 FAQ(#faq,手风琴)
3 条问答(zh,en 同步翻译;措辞只谈免费与功能,不替注册页承诺开放注册——注册本身仍走邀请码,由 /register 页面自行表达):
1. **免费吗?** 免费。注册后全部功能均可使用,没有功能墙。
2. **一个人也能用吗?** 能。每个账号都有私人空间;之后随时创建团队空间,把伙伴邀请进来。
3. **需要安装吗?** 不需要。浏览器打开即用,数据存在你自己的部署里。

### 4.6 底部 CTA(品牌渐变大色块)
- 标题:`现在,把第一件事做完`
- 副文案:`免费创建账号,和团队一起把事做成`(不提邀请码)
- 按钮:「免费开始使用」(白底紫字)、「登录」(描边)

### 4.7 页脚
`© 2026 Open Doing` + 三个锚点链接,极简单行。

## 5. 视觉规范

- 全部走 `tokens.css` 既有变量:背景 `--surface-subtle`/`#fff`,文字 `--ink-*`,品牌渐变 `linear-gradient(135deg,#7d2ae8 0%,#00c4cc 100%)`,圆角/阴影用 `--radius-*`/`--shadow-*`。**禁止字面量 hex**(mockup 里的 hex 仅为示意)。
- 图标一律 `lucide-react`(已是依赖);不引入 emoji。
- 字号体系沿用 `--text-*`;landing 的 H1 可按 mockup 用较大字号,实现时用 clamp() 做流式缩放,不新增 token 值。
- 新组件放 `src/features/landing/components/`;可复用的纯展示组件若与域无关,按惯例进 `src/components/ui/`。

## 6. 截图资产

- 来源:**运行中的应用**(带新 logo),不是 `docs/prototypes/`。
- 采集脚本入库:`apps/web/scripts/capture-landing-screenshots.mts` —— Playwright 以 `林夏 / seed-password` 登录 dev server(3000),依次打开 `/space/growth-squad/{dashboard,kanban,calendar,analysis}`,viewport 1440×900、deviceScaleFactor 2,输出到 `apps/web/src/features/landing/assets/`(dashboard / kanban / calendar / analysis 四张 PNG,入库提交)。
- 截图含种子数据,属开发样例,可入库;不得含真实用户数据。
- 页面内用 `next/image` 或 `<img>` 引入,固定宽高比防 CLS。

## 7. 动效规范(全部 Motion)

### 7.1 依赖与基础设施
- 新增依赖:`motion`(React 入口 `motion/react`)。
- `providers.tsx` 挂 `<MotionConfig reducedMotion="user">`:统一尊重 `prefers-reduced-motion`(`globals.css` 现有的 0.01ms 全局压制规则保留,二者叠加无害)。
- 客户端动效组件统一从 `motion/react` 导入 `motion` / `AnimatePresence` / `useScroll` / `useTransform` / `useInView`。

### 7.2 Landing 动效清单
| 位置 | 效果 | Motion 手段 |
|---|---|---|
| 首屏左列 | 徽标 chip → H1 → 副文案 → CTA 依次淡入上移 | variants + staggerChildren(80ms) |
| 首屏双屏 | 日历先入、看板后入,带旋转从偏移位漂移落位;浮动提醒卡之后弹入 | variants,rotation/offset 进场,spring |
| 浮动提醒卡 | 轻微上下浮动循环 | animate y: [0,-6,0] repeat Infinity |
| 功能区各行 | 滚动进入视口时淡入上移,图/文错峰 | whileInView + 错峰 delay |
| 截图层 | 滚动视差(相对滚动轻微位移) | useScroll + useTransform |
| 底部 CTA | 高光光晕缓慢平移循环;按钮 hover 轻微放大/位移 | animate 循环 + whileHover |
| 语言切换 chip | 点击后 chip 进入 pending 态;RSC 刷新带来新 locale 时,内容以新 locale 为 key 淡入(仅进场,不做退出等待) | key={locale} + initial/animate 淡入 |
| FAQ 手风琴 | 高度展开/收起 + 图标旋转 | AnimatePresence + height:auto 补间 |

时长/缓动对齐 token:入场用 `--ease-decelerate`,退场用 `--ease-accelerate`,时长落在 `--duration-*` 档位附近。Motion 的 tween 支持 cubic-bezier 数组,直接引用同一数值(在实现中常量化并注明与 token 对应)。

### 7.3 motion.css 浮层动画迁移(全项目统一)
- 范围:`od-overlay`(Dialog/AlertDialog 遮罩)、`od-modal`(中心弹窗)、`od-popover`(DropdownMenu/Popover/Select 等轻量浮层)、`od-sheet`(四向抽屉)。
- 机制(builder check 已核实):Radix 在 `open` 翻 false 的瞬间就卸载 Content,单纯用 `AnimatePresence` 包裹看不到退出动画。因此 vendored 组件内部改为**退出期保持 Radix open**:消费方的 `onOpenChange(false)` 先驱动 Motion 变体播放退出动画,动画完成后再真正关闭 Radix(`forceMount` + 组件内延迟关闭状态)。这要求重构 vendored `dialog.tsx` / `alert-dialog.tsx` / `sheet.tsx` / `popover.tsx` / `dropdown-menu.tsx` / `select.tsx` 的内部实现(超出以往 header 注释记录的适配级修改;新结构在各自 header 注释中完整记录,依旧不动 `(dashboard)/layout.tsx` 等冻结契约)。
- 受控消费方(如 `ConfirmModal`、`TaskDetailView`、`MobileNav`、各 `NewTaskModal`)的 Radix 状态会滞后其 `open=false` 约 0.2–0.3s:计划中需审计这些调用点是否存在"关闭后立即执行"的同步假设(焦点归还、表单重置、紧随的 refetch),逐个确认或调整时序。
- **保真迁移**:保留现有时长与缓动曲线(0.25s/0.42s/0.28s…,cubic-bezier(0.34,1.4,0.64,1) 等),以 tween + bezier 数组实现;弹簧化升级不属于本次范围。
- 迁移完成后:删除 `apps/web/src/app/motion.css` 及 `globals.css` 的 import;组件里的 `od-*` 类名全部移除;原文件头注释中记录的设计意图(iOS 弹簧、遮罩分层、缩放原点跟随)原样搬进新包装组件的注释。
- 缩放原点跟随 Radix transform-origin 的行为需保留(监听 `--radix-popover-transform-origin` 设置 motion 的 `transformOrigin` style)。
- 回归面:所有用到 Dialog/AlertDialog/DropdownMenu/Popover/Select/Sheet 的页面,退出动画必须完整播放后卸载(不得闪跳)。

## 8. i18n

- 新增 `landing` 命名空间,zh/en 结构完全一致(messages-parity);新页面全部文案(含 aria-label、alt)入目录,cjk-guard 正常约束。
- 匿名语言切换:landing 是纯匿名页,「中/EN」chip 调用一个 server action(如 `features/users` 或 landing 域内)写 `od_locale` cookie + `revalidatePath("/")`;读取沿用 `i18n/server.ts` 现有匿名解析链(无登录态,`users.language` 不参与)。切换后立即生效,不走登录态。
- dayjs/html lang 由既有根 Provider 机制自动跟随,无需新逻辑。

## 9. 测试要求

- 单测:landing 各区块组件的可序列化 props 映射、FAQ 手风琴开合逻辑、匿名 locale action(cookie 写入)。
- 既有守卫测试全绿:cjk-guard、messages-parity、AtomsShadcn(不得引入 antd)。
- 迁移浮层动画后,为「退出动画播放完再卸载」补一个针对性组件测试(AnimatePresence + Radix onOpenChange 时序)。
- e2e:新增 `flows/` 一条 landing 冒烟流程——匿名访问 `/` 可见首屏与各锚点、切 EN 后文案切换、点「免费开始」到 `/register`;已登录访问 `/` 跳个人仪表盘。
- 视觉:实现完成后在 1440×900 与 390×844 两档截图人工比对 mockup。

## 10. 留给实现者的决定

- 各区块拆分为哪些组件文件、客户端/服务端边界的具体划法。
- Motion 变体的具体数值(在遵守 §7 时长/缓动约束下微调到顺眼)。
- 截图在 `next/image` 与优化参数上的细节。
- FAQ 手风琴用 vendored Accordion(若可适配 Motion)或自建 motion 手风琴。

## 11. 已确认的关键决策记录

1. 定位:对外拉新的产品展示页;动效设计交由实现方,基于 Motion。
2. 视觉:亮色、品牌渐变点睛;首屏 B 方案(左文右双屏拼贴)。
3. 截图必须来自运行中的应用(新 logo)。
4. 不出现邀请码/内测表述。
5. 支持 zh/en,匿名可切换(导航 chip)。
6. 图标用 Lucide,不用 emoji。
7. FAQ 区要做。
8. 全项目动效统一 Motion;现有 motion.css 一并迁移后删除。
