# 原型重锚到 shadcn 词汇 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 `docs/prototypes/` 的 token 体系与组件类重写为 shadcn/ui 词汇,20 个页面布局/文案/DOM 不变,成为后续 antd→shadcn 生产迁移的视觉契约。

**Architecture:** 纯静态 HTML + 手写 CSS + 原生 JS,无构建。按组件族分任务:每个任务同时改 CSS 组件块与所有页面的对应 markup,保证每个 commit 页面始终可用。Task 1 先重构 token 层并把 `prototype.css` 的 `var()` 引用机械改指新名(类名未动,视觉零变化),后续任务逐组件族改类名。

**Tech Stack:** HTML5 / CSS(自定义属性,三层 token)/ 原生 JS

**Spec:** `docs/superpowers/specs/2026-11-02-shadcn-prototype-reanchor-design.md`

## Global Constraints

- Token **值**与 `docs/design/index.html` 及现有 primitive 1:1,只改组织与命名;唯一新增值:primitive `--purple-16: rgba(125, 42, 232, 0.16)`(对齐 docs/design 输入框 focus ring 规格)。
- 20 个页面的**文案字节级不变**(i18n 文案参照源);DOM 仅允许白名单新增(dialog-close 按钮、alert icon 位、empty-state 动作区、card 内部语义包裹),每项登记进 README 的「DOM 变更登记」。
- 页面保持 `file://` 直接可开;禁止引入 Tailwind CDN / 任何构建步骤 / 新字体。
- 暗色模式只留 `.dark` 注释占位;light-only。
- 状态偏差对齐上游 docs/design:focus ring 0.16、badge 11px(现 0.2 / 12px 属实现偏差)。
- 布局类(`.sidebar` `.topbar` `.auth-*` `.kanban` `.kcol*` 等)与业务类(`.table` `.task-*` `.risk-*` `.notif-*` `.member-row` `.comment*` `.subtask` `.meta-*` `.detail-*` `.stat*` `.team-switcher` `.switcher-wrap` `.proto-*`)**不改名**。
- 测试方式:本仓库原型无测试框架,每个任务的"测试"= 精确 grep 契约 + `file://` 浏览器目检;执行者不得跳过验证步骤。

## Review Focus

1. **文案漂移**:markup 批量改类名时误改正文——任何页面的文本节点 diff 必须为零(白名单元素内的按钮 aria-label 除外)。每个改页面的任务用 `git diff` 逐页确认只动了 `class`/白名单元素。
2. **悬空 `var()` 引用**:token 改名后 CSS 里残留 `var(--color-*)` 会静默回退为 unset,视觉悄悄坏掉。Task 1 的 grep 契约为零残留;后续任务不得再引入。
3. **弹层行为回归**:modal/dropdown 类名与 JS 选择器同步改名,Esc/点击外部关闭/焦点还原不能丢——Task 6 目检清单逐项点。
4. **白名单外 DOM 变更**:除登记项外,页面结构 diff 应只有 `class` 属性变化;发现结构 diff 即回退。
5. **file:// 回归**:每任务收尾用浏览器打开 1-2 个代表页,确认无样式全丢(典型原因:CSS 语法错误、token 名打错)。

---

### Task 1: Token 层重构(shadcn 语义层 + primitive 圆角值命名)

**Files:**
- Modify: `docs/prototypes/assets/design-tokens.css`
- Modify: `docs/prototypes/assets/prototype.css`(仅 `var()` 引用,类名与选择器不动)

**Interfaces:**
- Produces(Task 2-8 依赖的精确 token 名):shadcn 语义层 `--background --foreground --card --card-foreground --popover --popover-foreground --primary --primary-foreground --secondary --secondary-foreground --muted --muted-foreground --accent --accent-foreground --destructive --border --input --ring --radius --radius-sm --radius-md --radius-lg --radius-xl`;项目扩展 `--primary-hover --primary-bg --primary-bg-hover --text-secondary --text-faint --border-strong --surface-inset --brand-gradient --success --success-bg --warning --warning-bg --error --error-bg --info --info-bg --status-todo --status-todo-bg --status-progress --status-progress-bg --status-done --status-done-bg --status-overdue --status-overdue-bg --status-due-soon --status-due-soon-bg`;primitive 圆角 `--radius-4 --radius-6 --radius-8 --radius-12 --radius-16 --radius-pill`;新增 primitive `--purple-16`;组件令牌 `--badge-radius --badge-padding --badge-font-size`(由 `--tag-*` 改名,提前在本任务完成,值改指 `--text-tag`)

- [ ] **Step 1: 重写 `design-tokens.css` 的 SEMANTIC 区块**

旧→新逐一映射(值不变,`var()` 指向 primitive):

| 旧名 | 新名 |
|---|---|
| `--color-bg` | `--background` |
| `--color-surface` | `--card` |
| `--color-surface-hover` | `--muted`(同值 #f4f5f7) |
| `--color-surface-selected` | `--accent`(同值 #eef0fc) |
| `--color-surface-inset` | `--surface-inset`(扩展层,值同 primitive) |
| `--color-text` | `--foreground` |
| `--color-text-secondary` | `--text-secondary`(扩展) |
| `--color-text-muted` | `--muted-foreground` |
| `--color-text-faint` | `--text-faint`(扩展) |
| `--color-text-on-primary` | `--primary-foreground` |
| `--color-primary` | `--primary` |
| `--color-primary-hover` | `--primary-hover`(扩展) |
| `--color-primary-bg` / `--color-primary-bg-hover` | `--primary-bg` / `--primary-bg-hover`(扩展) |
| `--color-focus-ring` | 删除(ring 阴影改用新 primitive `--purple-16`) |
| `--color-brand-gradient` | `--brand-gradient` |
| `--color-border` | `--border` |
| `--color-border-strong` | `--border-strong`(扩展) |
| `--color-success` 及 success/warning/error/info 系列 | `--success` `--success-bg` `--warning` `--warning-bg` `--error` `--error-bg` `--info` `--info-bg`(扩展) |
| `--color-todo*` / `--color-progress*` / `--color-done*` / `--color-overdue*` / `--color-due-soon*` | `--status-todo*` `--status-progress*` `--status-done*` `--status-overdue*` `--status-due-soon*`(扩展) |

新增 shadcn 槽位(取值按 spec 映射表):`--popover/--popover-foreground`(白/墨)、`--secondary/--secondary-foreground`(#f4f5f7/墨)、`--card-foreground`、`--accent-foreground`(紫)、`--destructive`(#ff5757)、`--input`(#e1e3e6)、`--ring`(#7d2ae8)。卡片/浮层前景 = `--ink-900`。

- [ ] **Step 2: primitive 区改圆角命名 + 新增 --purple-16**

`--radius-xs/sm/btn/card/panel/pill` → `--radius-4/6/8/12/16/pill`;SEMANTIC 尾部追加 `--radius: var(--radius-8); --radius-sm: var(--radius-6); --radius-md: var(--radius-8); --radius-lg: var(--radius-12); --radius-xl: var(--radius-16);`;primitive 紫区追加 `--purple-16: rgba(125, 42, 232, 0.16);`

- [ ] **Step 3: COMPONENT 区引用与改名**

所有 `var(--color-*)` 引用按 Step 1 表改;`--button-radius: var(--radius)`、`--input-radius: var(--radius)`、`--card-radius: var(--radius-lg)`;`--tag-radius/--tag-padding/--tag-font-size` 改名为 `--badge-*`,且 `--badge-font-size: var(--text-tag)`(11px,对齐 docs/design);文件头注释"生产实现映射到 antd v6 ConfigProvider"改为"生产实现映射到 shadcn/ui + Tailwind CSS 4";文件尾 `[data-theme="dark"]` 注释改为 `.dark` 注释占位(`/* .dark { … } — shadcn 暗色约定,v1 亮色 only */`)。

- [ ] **Step 4: `prototype.css` 的 `var()` 引用机械改名**

按 Step 1 表把 prototype.css 里全部 `var(--color-*)` 与 `var(--radius-*)` 旧引用改为新名;`--tag-*` 组件令牌引用改 `--badge-*`。**不改任何选择器/类名/属性值。**

- [ ] **Step 5: 验证**

Run: `grep -rn 'color-\|radius-xs\|radius-btn\|radius-card\|radius-panel\|radius-sm:\|focus-ring' docs/prototypes/assets/*.css | grep -v 'status-' | grep -v radius-sm:`
Expected: 零命中(无任何 `--color-*` / 旧圆角名残留)。
Run: `grep -c 'var(--primary)\|var(--border)\|var(--foreground)' docs/prototypes/assets/prototype.css`
Expected: >0(新引用已生效)。
浏览器 `file://` 打开 `docs/prototypes/space-dashboard-personal.html` 与 `login.html`:与改动前对比**视觉零变化**。

- [ ] **Step 6: Commit**

```bash
git add docs/prototypes/assets/
git commit -m "refactor(prototypes): restructure tokens to shadcn variable schema"
```

---

### Task 2: Button 组件族

**Files:**
- Modify: `docs/prototypes/assets/prototype.css`(`.btn*` 区块)
- Modify: `docs/prototypes/assets/prototype.js`(如有 `.btn` 选择器引用)
- Modify: 全部 20 个 HTML 页面(btn 类出现处)

**Interfaces:**
- Consumes: Task 1 的 `--primary --primary-hover --primary-foreground --destructive --muted` 与组件令牌 `--button-*`(名字不变)。
- Produces: `.button` 基类 + 复合修饰类 `.button-primary .button-gradient .button-outline .button-ghost .button-link .button-destructive .button-sm .button-lg .button-block .button-loading`;`.icon-button`(原 `.icon-btn`)。

- [ ] **Step 1: CSS 类重写(prototype.css)**

改名映射:`.btn`→`.button`、`.btn-primary`→`.button-primary`、`.btn-gradient`→`.button-gradient`、`.btn-default`→`.button-outline`、`.btn-text`→`.button-ghost`、`.btn-danger`→`.button-destructive`、`.btn-sm`→`.button-sm`、`.btn-lg`→`.button-lg`、`.btn-block`→`.button-block`、`.icon-btn`→`.icon-button`。属性值与状态(:hover 等)保持现值不变。新增 `.button-loading`(spinner 图标位 + `pointer-events: none; opacity: .7`;尺寸/圆角继承 `.button`)。变体到 token:primary 用 `--primary/--primary-foreground`,outline 用 `--card` 底 + `--border` 描边,ghost 用透明底 + `--foreground` 文本,destructive 用 `--destructive`。

- [ ] **Step 2: 全部页面 markup 改类名**

20 个 HTML 中 `btn-`/`btn ` class token 按映射替换(`icon-btn` 同步)。**只动 class 属性。**

- [ ] **Step 3: 验证**

Run: `grep -rlnE 'class="[^"]*\b(btn|btn-[a-z]+|icon-btn)\b' docs/prototypes/*.html`
Expected: 零命中。
Run: `git diff docs/prototypes/*.html | grep -E '^[+-]' | grep -vE '^[+-]{3}' | grep -vE 'class='`
Expected: 零输出(文案零漂移)。
浏览器打开 `login.html`(渐变 CTA)与 `space-dashboard-personal.html`(多按钮密度页):按钮观感与改动前一致。

- [ ] **Step 4: Commit**

```bash
git add docs/prototypes/
git commit -m "refactor(prototypes): rename button classes to shadcn vocabulary"
```

---

### Task 3: Badge 组件族

**Files:**
- Modify: `docs/prototypes/assets/prototype.css`(`.tag*` 区块)
- Modify: 全部 20 个 HTML 页面

**Interfaces:**
- Consumes: Task 1 的 `--badge-radius --badge-padding --badge-font-size`、`--status-*` 系列。
- Produces: `.badge` + `.badge-todo .badge-progress .badge-done .badge-overdue .badge-due-soon .badge-info .badge-neutral .badge-role .badge-lavender`(后缀与旧 `tag-*` 一一对应)。badge 字号改为 11px/600/0.04em 字距(docs/design 对齐)。

- [ ] **Step 1: CSS 类重写**

`.tag`→`.badge`,全部 `tag-*` 修饰类同后缀改名;字号从 `--text-caption`(12px)改绑 `--badge-font-size`(`--text-tag`,11px)。颜色绑定全部走 Task 1 的 `--status-*` 等扩展 token。

- [ ] **Step 2: 全部页面 markup 改类名**(同 Task 2 模式,只动 class)

- [ ] **Step 3: 验证**

Run: `grep -rlnE 'class="[^"]*\btag(\s|-)(todo|progress|done|overdue|due-soon|info|neutral|role|lavender)|\btag\b' docs/prototypes/*.html`
Expected: 零命中。
浏览器打开 `my-tasks.html`、`project-list.html`:状态徽章变 11px,颜色/药丸形态不变。

- [ ] **Step 4: Commit**

```bash
git add docs/prototypes/
git commit -m "refactor(prototypes): rename tag classes to badge, align 11px spec"
```

---

### Task 4: Card + Alert(callout)

**Files:**
- Modify: `docs/prototypes/assets/prototype.css`
- Modify: 全部 20 个 HTML 页面(仅 `.callout` 出现处)
- Modify: `docs/prototypes/README.md`(追加「DOM 变更登记」节)

**Interfaces:**
- Produces: `.card .card-header .card-title .card-content .card-footer`(后四者仅在现有 markup 可自然拆分处使用,不造空壳);`.alert` + `.alert-info .alert-warning .alert-error .alert-success`(原 `.callout` 及其 modifier)。

- [ ] **Step 1: CSS 重写**——`.card*` 类名对齐 shadcn(补 `card-title/content/footer` 样式定义,属性值不变);`.callout` 区块改名为 `.alert` + 四 variant(颜色绑 `--info/--warning/--error/--success` 与各自 bg)。
- [ ] **Step 2: 页面更新**——`callout` 出现页改类名;callout 若无 icon,按白名单在 `.alert` 内加 icon 位 `<span class="alert-icon" aria-hidden="true"></span>`(CSS 用 ::before 画图标也接受,取更简单者)。
- [ ] **Step 3: README 追加「DOM 变更登记」节**,登记每个页面加入的 alert icon 位。
- [ ] **Step 4: 验证**

Run: `grep -rln 'callout' docs/prototypes/`
Expected: 零命中(README 的登记文字除外)。
浏览器打开含 alert 的页面(如 `task-detail.html` 权限提示):形态/颜色一致,icon 出现。

- [ ] **Step 5: Commit**

```bash
git add docs/prototypes/
git commit -m "refactor(prototypes): rename callout to alert, align card classes"
```

---

### Task 5: 表单控件(input/textarea/label/form-item/select/checkbox/toggle-group)

**Files:**
- Modify: `docs/prototypes/assets/prototype.css`
- Modify: 全部 20 个 HTML 页面

**Interfaces:**
- Produces: `.input .textarea`(名字不变,样式对齐规格)、`.form-item`(新增:`.form-item > label + 控件 + .form-item-error`)、`.form-item-error`(红字 12px)、`.select`(原 `.filter-select`)、`.checkbox`(名不变)、`.toggle-group .toggle-group-item`(原 `.seg`,JS hook `data-seg` **保留不动**)。错误态类名 `.has-error` **保留**(页面/JS 已在用)。

- [ ] **Step 1: CSS 重写**——focus 规格落地:`.input:focus-visible, .textarea:focus-visible, .select:focus-visible { border-color: var(--ring); box-shadow: 0 0 0 3px var(--purple-16); outline: none; }`;所有交互控件(button/badge/card 可交互项等)统一 `:focus-visible { outline: 2px solid var(--ring); outline-offset: 2px; }` 基线;新增 `.form-item`/`.form-item-error`;`.filter-select`→`.select`(36px 高、8px 圆角、原生 chevron 背景);`.seg`→`.toggle-group`,item 选中态用 `--accent` 底 + `--accent-foreground` 文本。
- [ ] **Step 2: 页面 markup**——`filter-select`→`select`、`seg`→`toggle-group/toggle-group-item`(保留 `data-seg`);有 label+控件组合处包 `.form-item`(白名单:仅结构包裹,不加新文案;`form-row` 布局类保留)。
- [ ] **Step 3: 验证**

Run: `grep -rln 'filter-select\|class="[^"]*\bseg\b' docs/prototypes/*.html`
Expected: 零命中。
浏览器打开 `login.html`/`register.html`,Tab 走一遍焦点:紫 ring 出现;`team-settings.html` 的 segmented 切换仍工作(JS 未破坏)。

- [ ] **Step 4: Commit**

```bash
git add docs/prototypes/
git commit -m "refactor(prototypes): align form controls and focus rings to shadcn spec"
```

---

### Task 6: 弹层族(dialog / dropdown-menu / popover)+ JS 行为

**Files:**
- Modify: `docs/prototypes/assets/prototype.css`(modal/menu/popover 区块)
- Modify: `docs/prototypes/assets/prototype.js`
- Modify: 全部 20 个 HTML 页面(modal/menu 出现处)
- Modify: `docs/prototypes/README.md`(「DOM 变更登记」追加)

**Interfaces:**
- Consumes: Task 1 `--popover --shadow-popover --shadow-modal --duration-sheet --ease-standard`。
- Produces: `.dialog .dialog-overlay .dialog-header .dialog-content .dialog-footer .dialog-close`;`.dropdown-menu .dropdown-menu-item .dropdown-menu-label .dropdown-menu-separator`;`.popover .popover-head .popover-foot`(名不变)。JS 导出行为:Esc/点遮罩关闭、开启焦点入、关闭焦点还原、dropdown 上下键。

- [ ] **Step 1: CSS 重写**——modal→dialog 改名(overlay 用 `--popover` 底、`--shadow-modal`);`menu-*`→`dropdown-menu-*`(item hover 用 `--accent`);popover 区块命名不变、变量引用对齐 Task 1。
- [ ] **Step 2: JS 重写(prototype.js,108 行,就地改)**——现有 modal 开关函数改操作 `.dialog`/`.dialog-overlay`;新增:打开时 `focus` 移入 dialog 第一个可聚焦元素,关闭后焦点还原到触发元素;dropdown(原 `.menu` 容器)支持 ArrowUp/ArrowDown 在 `.dropdown-menu-item` 间移动焦点、Esc 关闭;现有子任务进度联动/看板拖放逻辑**零改动**。
- [ ] **Step 3: 页面 markup**——modal 类名按映射替换;每个 `.dialog` 加右上角关闭钮 `<button class="dialog-close" aria-label="关闭">×</button>`(白名单,逐页登记 README);`menu-*` 改名。
- [ ] **Step 4: README「DOM 变更登记」**追加 dialog-close 条目。
- [ ] **Step 5: 验证**

Run: `grep -rlnE 'class="[^"]*\bmodal|menu-(item|divider|label)' docs/prototypes/*.html`
Expected: 零命中。
浏览器打开 `my-tasks.html`(新建任务弹窗)与 `team-settings.html`(危险操作确认):Esc 关闭 ✓、点遮罩关闭 ✓、关闭后焦点回到触发按钮 ✓;通知 popover 仍正常。

- [ ] **Step 6: Commit**

```bash
git add docs/prototypes/
git commit -m "refactor(prototypes): rename modal/menu to dialog/dropdown-menu with radix-like behavior"
```

---

### Task 7: 新状态规格(skeleton / toast / empty-state 动作区)

**Files:**
- Modify: `docs/prototypes/assets/prototype.css`
- Modify: `docs/prototypes/assets/prototype.js`(追加 `toast()`)
- Modify: `docs/prototypes/README.md`(「DOM 变更登记」追加 empty-state 动作区条目,如有页面使用)

**Interfaces:**
- Produces: `.skeleton`(灰底 `--surface-inset` + 1.2s 微光扫过动画)、`.toast .toast-success .toast-error`(右下角固定、紧凑卡片、4s 自动消失、icon 位);`window.toast(message, variant)` JS 函数;`.empty-state` 补 `.empty-state-actions` 动作区样式(业务页如已有动作区则沿用现有 markup)。

- [ ] **Step 1: CSS 新增** skeleton/toast/empty-state-actions 三个区块(toast 定位 `position: fixed; right: 24px; bottom: 24px; z-index` 高于 dialog)。
- [ ] **Step 2: JS 追加 `toast(message, variant)`**:创建/复用 `.toast` 容器、4s 移除、成功/错误 icon 按 variant;不改既有函数。
- [ ] **Step 3: 验证**——浏览器控制台执行 `toast('测试', 'success')`:右下角出现、4s 消失、Esc/页面交互不受影响。本任务**不改任何业务页面**。

- [ ] **Step 4: Commit**

```bash
git add docs/prototypes/assets/
git commit -m "feat(prototypes): add skeleton, sonner-style toast, empty-state actions spec"
```

---

### Task 8: index.html 状态规格演示区

**Files:**
- Modify: `docs/prototypes/index.html`(导航页尾部追加演示区块)

**Interfaces:**
- Consumes: Task 2 `.button-loading`、Task 5 focus ring、Task 7 `.skeleton`/`.toast()`/`window.toast`。

- [ ] **Step 1: 追加「状态规格演示」区块**到 index.html(原型导航页,非业务页,允许新文案):一组按钮含 `.button-loading`(JS 点击 2s 后还原)、三行 `.skeleton`、两个 toast 触发按钮(success/error)、一个可 Tab 聚焦的 `.input` 展示 focus ring。演示区自身用 `.card` 包裹,标注为状态规格参照。
- [ ] **Step 2: 验证**——浏览器打开 index.html:四类演示全部可交互;业务页面不受影响。

- [ ] **Step 3: Commit**

```bash
git add docs/prototypes/index.html
git commit -m "feat(prototypes): add state-spec demo section to prototype index"
```

---

### Task 9: README 更新(生产契约改指 shadcn)

**Files:**
- Modify: `docs/prototypes/README.md`

- [ ] **Step 1: 更新三处**——①技术落地目标改为 "Next.js 16 + shadcn/ui(Radix + Tailwind CSS 4)";②设计令牌摘要表更新为 Task 1 的新变量名(品牌/语义/状态/圆角阴影间距各组);③「生产接入依据」的 antd ConfigProvider 映射表改写为 shadcn/Tailwind CSS 4 生产映射(变量落 `@theme`、输入高度 38px→input token、圆角 8/12 取 `--radius/--radius-lg` 等);④保留「DOM 变更登记」节;⑤文件结构说明"生产由 antd + Tailwind 还原"→"生产由 shadcn/ui + Tailwind 还原"。
- [ ] **Step 2: 验证**——`grep -n 'antd' docs/prototypes/README.md` 仅允许出现在「从 antd 迁移而来」的说明句中;组件清单/文案对照描述未被动过。
- [ ] **Step 3: Commit**

```bash
git add docs/prototypes/README.md
git commit -m "docs(prototypes): retarget README production mapping to shadcn/ui"
```

---

### Task 10: 全量终验收

**Files:** 无新改动(纯验收;发现问题回到对应任务修复后重跑本任务)

- [ ] **Step 1: grep 全量契约**

Run: `grep -rlnE 'class="[^"]*\b(btn|tag|modal|callout|filter-select|seg|icon-btn)\b' docs/prototypes/*.html`
Expected: 零命中。
Run: `grep -rn 'var(--color-' docs/prototypes/assets/`
Expected: 零命中。

- [ ] **Step 2: 文案零漂移全量校验**

Run: `git diff 09b731d..HEAD -- docs/prototypes/*.html | grep -E '^[+-]' | grep -vE '^[+-]{3}' | grep -vE 'class=|dialog-close|alert-icon|aria-label|<button|</button>|form-item|<span|</span>|toggle-group|<label|</label>'`
Expected: 零输出(所有 ± 行都能归因到 class 改名或白名单元素)。

- [ ] **Step 3: 20 页逐页目检**(file://,1440 宽)——每页与 `09b731d` 版本并排对比:布局像素级一致;白名单元素逐项对上 README 登记;无样式全丢页面。代表页必查:login / my-tasks / space-dashboard-personal / space-kanban-team / task-detail / team-settings。

- [ ] **Step 4: 收尾**——若全部通过,在 README「DOM 变更登记」节尾标注验收日期与基准 commit;提交(如有登记更新)。

```bash
git add docs/prototypes/README.md
git commit -m "docs(prototypes): mark shadcn re-anchor acceptance complete"
```
