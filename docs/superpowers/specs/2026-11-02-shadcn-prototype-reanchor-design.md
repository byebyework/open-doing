# 原型重锚到 shadcn/ui 词汇(antd → shadcn 迁移 · 第一阶段)

日期:2026-11-02
状态:待评审

## 背景与动机

本项目(open-doing)计划将 UI 组件库从 antd v6 迁移到 shadcn/ui。动机是长期的:未来开发以 vibecoding 为主,shadcn/ui 的组件代码以源码形式存在于仓库内(Radix + Tailwind + CVA),agent 可以直接阅读和修改,不依赖黑盒组件库的内部行为。

现有静态原型(`docs/prototypes/`)是实现阶段的"冻结视觉契约"。但当前原型是按 **antd 的组件形态**绘制的:弹窗、下拉、消息提示等交互形态都是 antd 的形状,README 中 token 的生产映射目标写的是"antd v6 ConfigProvider"。若直接以这些原型为契约做 shadcn 迁移,实现者需要在两种组件词汇之间自行翻译。

本项目的目标:**把原型重锚(anchor)到 shadcn/ui 词汇上**,使其成为 shadcn 迁移阶段的直接视觉契约。

已确认的范围决策(与用户确认过):

- **布局、信息架构、文案全部不动**——只重做组件层(token 结构 + 组件类 + 交互形态)。
- 原型先全部重做完,再动生产代码(用户已拍板"先定下原型")。

背景数据:当前 `apps/web` 中 90 个 tsx 文件有 58 个引用 antd。使用面:Button 36 文件、`App.useApp()` message 31 文件、Input 16、Alert 14、Form 12 文件(64 个 `Form.Item`)、Select 9、Tag 7、Modal 6、Dropdown 4、Calendar 1。无 Table/DatePicker/Upload 等重型组件。

## 目标

### 1. Token 体系重構(`assets/design-tokens.css`)

保持三层架构(primitive → semantic → component),**所有 primitive 值与 `docs/design/index.html` 及现有文件 1:1 不变**,改变的是 semantic 层的命名结构,向 shadcn 的 CSS 变量 schema 对齐:

- 新增 shadcn 标准语义变量,**逐变量取值映射表**(值全部来自现有 primitive,不改值):

  | shadcn 变量 | 取值 | 说明 |
  |---|---|---|
  | `--background` / `--foreground` | `#ffffff` / `#0e1318` | 画布 / 主文本 |
  | `--card` / `--card-foreground` | `#ffffff` / `#0e1318` | |
  | `--popover` / `--popover-foreground` | `#ffffff` / `#0e1318` | |
  | `--primary` / `--primary-foreground` | `#7d2ae8` / `#ffffff` | |
  | `--secondary` / `--secondary-foreground` | `#f4f5f7` / `#0e1318` | 次级按钮底 |
  | `--muted` / `--muted-foreground` | `#f4f5f7` / `#5f6368` | 弱填充 / 弱文本 |
  | `--accent` / `--accent-foreground` | `#eef0fc` / `#7d2ae8` | 菜单/下拉 hover 底(紫 tint) |
  | `--destructive` | `#ff5757` | |
  | `--border` / `--input` | `#e1e3e6` / `#e1e3e6` | 输入框描边沿用 default hairline |
  | `--ring` | `#7d2ae8` | 焦点 ring 阴影用 `--purple-16`(0.16 透明度,见 §2 对齐说明) |
  | `--radius` | `8px` | 派生:`--radius-sm` 6 / `--radius-md` 8 / `--radius-lg` 12 / `--radius-xl` 16;胶囊 9999px 保留 |

  **半径命名冲突处理**:primitive 层的圆角刻度改为值命名(`--radius-4/6/8/12/16`),semantic 层的 `--radius-*` 派生引用它们,消除现有 `--radius-sm` 重名。
- 保留品牌专属 token(渐变 `--brand-gradient`、分类点缀色 coral/tangerine/mint/sky/lavender 及其底色、任务状态配色),这些超出 shadcn 默认 schema,属项目自有扩展层。
- 保留字号/间距/阴影/动效 token,值不变;阴影与动效 token 改为被 shadcn 语义层引用。
- **语义层是替换而非并行**:与 shadcn 名字重叠的旧 `--color-*` 语义别名删除,`prototype.css` 全部改指向新名;品牌扩展 token 保留原名。
- 文件头注释的"生产实现映射到 antd v6 ConfigProvider"改为"映射到 shadcn/ui + Tailwind CSS 4"。
- 增加 `.dark` 空占位选择器(注释形式,值留空),为未来暗色模式预留结构,本期不定义暗色值。

### 2. 组件层重写(`assets/prototype.css`,992 行)

组件类名与变体结构改为 shadcn 词汇(原型仍是手写 CSS,不引入 Tailwind;映射发生在 token 与组件形态层)。**类命名语法:复合修饰类**——组件名为基类,变体/尺寸/状态名直接跟在后面作独立类,如 `class="button button-outline button-sm"`、`class="badge badge-overdue"`、`class="button button-loading"`(示例:次要小号按钮 = `button button-outline button-sm`;渐变主 CTA = `button button-gradient button-lg`)。现有组件清单已盘点,逐项对应:

| 现有类 | shadcn 词汇 | 说明 |
|---|---|---|
| `.btn` / `.btn-primary` / `.btn-gradient` / `.btn-default` / `.btn-text` / `.btn-danger` / `.btn-sm` / `.btn-lg` | `button` + variants:`default`(紫色实心)、`gradient`(品牌时刻)、`outline`(白色描边)、`ghost`、`link`、`destructive`;sizes:`sm`/`default`/`lg` | 对应 shadcn Button 的 CVA 变体结构;渐变变体为项目自有扩展 |
| `.tag` + `.tag-todo/progress/done/overdue/due-soon/info/neutral/role/lavender…` | `badge` + variants 同名 | 9999px 药丸、11px/600/大写字距规范保持 |
| `.card` / `.card-header` | `card` / `card-header` / `card-title` / `card-content` / `card-footer` | 12px 圆角、静止/悬停阴影不变 |
| `.modal` / `.modal-backdrop` / `.modal-header` / `.modal-footer` | `dialog`:`dialog-overlay` / `dialog-content` / `dialog-header` / `dialog-footer` / `dialog-close` | 形态对齐 Radix Dialog(见 §3) |
| `.menu-item` / `.menu-divider` / `.menu-label` | `dropdown-menu`:`dropdown-menu-item` / `dropdown-menu-separator` / `dropdown-menu-label` | |
| `.popover` 系列 | `popover` 系列命名 | 通知 popover 等保持功能 |
| `.input` / `.textarea` / `.input-group` / `.input-prefix` | `input` / `textarea` / `label` / `form-item`(含 label + 错误文本形态) | 补齐 focus ring 规格:border `--ring` + `0 0 0 3px rgba(125,42,232,.16)`;补错误态(红边 + 错误文案样式) |
| `.checkbox` / `.switcher-wrap`(segmented) | `checkbox`;segmented → `toggle-group` 形态 | |
| `.filter-select` | `select`(原型内保持原生 `<select>` 加样式,形态对齐 shadcn Select:36px 高、8px 圆角、chevron) | |
| `.progress` | `progress` | |
| `.avatar` / `.avatar-stack` / `.av-*` | `avatar` + 分类色 tint variants 不变 | |
| `.callout` | `alert`(info/warning/error/success 四 variant) | |
| `.table` / `.task-list` / `.task-row` | 保留(项目自有业务组件,非 shadcn 原子),命名不动 | |
| `.kanban` 系列、`.auth-*`、`.sidebar`、`.topbar` 等布局类 | 保留不动 | 布局层不在重做范围 |
| `.empty-state` | `empty-state` 保留,补插画位/动作区规格 | |
| `.load-dots` | 新增 `skeleton`(骨架屏形态)规格,load-dots 保留 | |

**补齐 antd 时代缺失的状态规格**(antd 默认渲染、原型没画的):

- 所有交互元素的 `:focus-visible` ring 统一规格:**输入类 focus 时 border 变 `--ring` 实色 + 阴影 `0 0 0 3px var(--purple-16)`**。说明:现原型 `--color-focus-ring` 用 0.2 透明度、badge 用 12px,均属对 `docs/design` 的实现偏差;本次重锚一律对齐上游 `docs/design` 规格(ring 0.16、badge 11px/600/大写/0.04em 字距)。现有 `.input.has-error` 红边错误态保留,作为表单错误态规格。
- toast 形态:对齐 sonner(右下角、单条紧凑卡片、成功/错误 icon、4s 自动消失),新增 `.toast` 系列样式;`prototype.js` 提供 `toast(message, variant)` 函数。**演示点只加在原型导航页 `index.html` 的组件演示区**(新增"状态规格演示"区块),业务页面一律不加,避免触碰冻结文案。
- 骨架屏 `.skeleton`(灰底 + 微光扫过动画),同样仅在 index.html 演示区出现。
- 按钮 `.button-loading` 态(图标位 + 禁用),仅 CSS 规格 + index.html 演示。
- Dialog 的键盘/焦点行为样式(见 §3)。

### 3. 交互层(`assets/prototype.js`)

行为对齐 Radix 语义,实现仍是原生 JS:

- Dialog/Popover/Dropdown:Esc 关闭、点击遮罩/外部关闭、打开时焦点移入、关闭后焦点还原(轻量实现,不追求完整 focus trap)。
- DropdownMenu 键盘上下键移动焦点。
- `toast(message, variant)` 演示函数,替换现在直接用 antd message 心智的演示点。
- 现有功能(子任务进度联动、看板拖放、popover)全部保留。

### 4. 页面更新(20 个 HTML)

- 所有页面 markup 换用新类名;**DOM 结构、布局、文案逐一保持与现版本一致**(文案是 i18n 文案的参照源)。
- **DOM 冻结的例外白名单**(shadcn 组件形态要求的少量新增元素,允许添加):Dialog 右上角关闭按钮(`dialog-close`)、Alert 的 icon 位、`empty-state` 的动作区、卡片内部 `card-title`/`card-content` 语义包裹(仅当现有 markup 恰好可分时,不为凑结构而加空壳)。除白名单外,一律不改 DOM。
- 逐页验收:浏览器直接打开(file://),1440 宽度下与现版本并排对比:**布局像素级不变**;白名单元素导致的局部像素变化逐一登记;组件质感按新规格。

### 5. 文档更新

- `docs/prototypes/README.md`:技术落地目标改为 "Next.js 16 + **shadcn/ui**(Radix + Tailwind CSS 4)";设计令牌摘要表格更新为新变量名;文件结构说明中"生产由 antd + Tailwind 还原"改为"生产由 shadcn/ui + Tailwind 还原";原"生产接入依据"中的 antd ConfigProvider 映射表(controlHeight 等)**改写为等价的 shadcn/Tailwind CSS 4 生产映射**(变量如何落入 Tailwind `@theme`、输入高度/圆角等如何取自语义 token),保持 README 继续作为可用的生产契约。
- 本项目**不**修改 AGENTS.md / ARCHITECTURE.md(生产代码迁移阶段一并更新,避免文档先于事实)。

## 非目标

- 不改布局、信息架构、文案、示例数据。
- 不画暗色模式页面(仅 token 结构占位)。
- 不改 `apps/web` 任何代码。
- 原型不引入 Tailwind CDN / 构建步骤,保持纯静态 HTML + 手写 CSS。
- 不重写 `docs/design/`(它是上游来源,保持原样)。

## 约束

- **Token 值 1:1**:所有颜色/字号/间距/圆角/阴影/动效数值与 `docs/design/index.html` 规格及现有 primitive 值完全一致,只改组织结构与命名。
- 文案零变化(中英文示例均保留)。
- 页面保持 `file://` 直接可开,无构建。
- 资源组织沿用 `assets/design-tokens.css + prototype.css + prototype.js` 三文件结构,就地重写(git 历史保留旧版)。

## 已定的实现选择(作者判断,可否决)

1. **暗色模式本期不做**,仅留 `.dark` 结构占位。
2. **字体栈沿用现状**(`Canva Sans`/`YS Text`/`system-ui` + 中文字体兜底),本期不引入新字体。
3. **Select 在原型中保持原生 `<select>` 加样式**,不模拟 Radix 下拉的完整行为(原型追求形态对齐,不追求行为复刻;生产行为由 Radix 提供)。
4. **手写 CSS**,不用 Tailwind CDN——原型的职责是定义视觉契约,不是预演生产代码结构。
5. 组件类命名采用 shadcn 官方组件名(kebab-case)作为基类,变体用**复合修饰类**(`.button-outline`、`.badge-overdue`),尺寸/状态同机制(`.button-sm`、`.button-loading`)。
6. **语义层替换而非并行**:重叠旧名删除,品牌扩展保留。
7. **DOM 冻结白名单**:dialog 关闭钮、alert icon 位、empty-state 动作区、card 内部语义包裹(见 §4)。
8. **对齐上游偏差**:focus ring 0.16、badge 11px,以 `docs/design` 为准(现原型 0.2 / 12px 属实现偏差)。
9. **新状态(toast/skeleton/loading)只做规格 + index.html 演示区**,业务页面不加演示点、不加新文案。

## 留给实现者

- CSS 文件内部的分区组织与类命名细节(遵循上表的命名前缀即可)。
- 逐页更新的顺序与批量策略(建议:先改共享 CSS 保证多数页面自动生效,再逐页改 markup 中的旧类名)。
- 表单类页面(login/register/各弹窗)中 `form-row` 的 `form-item` 化细节。
- 轻量焦点管理(§3)的具体实现方式。
