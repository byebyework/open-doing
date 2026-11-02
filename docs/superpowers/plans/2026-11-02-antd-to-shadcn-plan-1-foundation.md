# antd → shadcn/ui 迁移 Plan 1:看板统计原型 + shadcn 地基 + auth 试点

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把看板统计补进冻结原型,搭好 shadcn 基建(antd 共存、视觉零变化),并用 auth 模块试点跑通 react-hook-form + zod 表单策略全链路。

**Architecture:** 三个独立可验收的任务:原型改动(纯 HTML,进 README 登记册)→ 基建(手工 vendor shadcn 组件源码、接入既有 tokens.css、挂 sonner,不运行 shadcn init)→ auth 试点(antd Form → RHF+zod,产出后续模块复用的 `applyActionErrors` 映射约定)。antd 全程保留渲染,ConfigProvider 不动。

**Tech Stack:** Next.js 16.4.2 (App Router) · React 19.3 · Tailwind CSS 4(CSS-first,无 config 文件) · antd 6.6.7(共存) · shadcn/ui(手工 vendor) · react-hook-form + zod · sonner · next-intl

**Spec:** `docs/superpowers/specs/2026-11-02-antd-to-shadcn-migration-design.md`

**Scope 说明:** 本计划是两份计划中的第一份。Plan 2(teams → personal → users/notifications → dashboard+kanban → 团队 tasks/projects → calendar → 清场)在 Task 3 落地后编写——它消费 Task 3 定下的真实表单模式,提前写只能是猜测。

## Global Constraints

- 视觉验收线:「令牌 + 组件形态 + 文案一致」;stock shadcn/Radix 默认差异(动画曲线、箭头字形、焦点环渲染)不追,不为像素一致定制组件。(spec「用户已定的决策」)
- Phase 0/1 期间 antd 组件继续渲染:不移除、不改 ConfigProvider/AntdRegistry/AntApp。
- 设计令牌零改动:vendored 组件一律引用 `apps/web/src/app/tokens.css` 既有语义变量;组件内不得引入 shadcn 默认词汇(--primary/--muted 等),若某槽位缺失,按 `docs/prototypes/assets/design-tokens.css` 同名值补入 tokens.css 并同步原型文件。
- 组件映射与令牌→shadcn 词汇对照,以 `docs/prototypes/README.md` 的 shadcn/@theme 映射表为准。
- 不运行 `shadcn init` / `shadcn add`(CLI 会注入默认主题变量与 preflight);组件源码从 shadcn/ui 官方仓库手工拷入并适配,保持官方组件 API 不变。
- Tailwind preflight 保持关闭(`apps/web/src/app/globals.css` 现状),不新增全局样式重置;`box-sizing: border-box` 手动规则保留。
- 所有用户可见文案进 `src/i18n/messages/{zh,en}.json`,零硬编码(cjk-guard / messages-parity 测试强制)。
- e2e 依赖 `data-testid` 选择器:迁移中所有既有 `data-testid` 原样保留,不得改名或删除。
- 测试环境命令(每次都必须):vitest/db 操作前 `set -a; source apps/web/.env.local; set +a`;typecheck 前先 `pnpm --filter @open-doing/web exec next typegen`;e2e 前停掉 dev server(Next 16 同目录锁),跑完重启。
- 测试库由 TEST_DATABASE_URL 指定且会被 truncate,严禁指向开发库。
- 提交信息:Conventional Commits,英文主题行(如 `feat(auth): migrate login form to react-hook-form + shadcn`)。

## Review Focus

1. **Server Action 失败反馈链路**:antd message 换成别的提交方式后,action 的 form 级/字段级错误必须仍到达用户(登录失败在用户名下方红字,不是无声)。→ Task 3 的 applyActionErrors 单测 + 手动 Playwright 错误路径走查钉住。
2. **注册页交叉字段校验**(password2 不一致):错误必须出现在字段旁(aria-describedby 关联),不是只有顶部 form 错误。→ Task 3 手动走查 + register.html 原型对照。
3. **提交态**:提交按钮在请求开始前保持可用、请求中禁用 + spinner;网络异常显示 networkError 文案。→ Task 3 手动走查。
4. **共存期视觉零回归**:Phase 1 加了 Toaster 与 vendored 组件但没有任何页面换用,任何页面不得因此变形。→ Task 2 全量测试 + e2e 冒烟钉住。
5. **locale 机制不受干扰**:根 Providers 挂 Toaster 后,html lang、antd/dayjs locale 切换(en 冒烟)不得回归。→ Task 2 e2e `12-en-locale-smoke` 钉住。

---

### Task 1: 看板统计原型补全(Phase 0)

**Files:**
- Modify: `docs/prototypes/space-kanban-team.html`
- Modify: `docs/prototypes/space-kanban-personal.html`
- Modify: `docs/prototypes/README.md`(DOM 变更登记 + 验收基准行)

**Interfaces:**
- Consumes: 现有原型组件类(`.stat-chip` 形态参照 `space-dashboard-team.html` 的统计卡样式类;`.progress` 参照现有进度条类);设计令牌 `--danger-500`(或 danger 语义槽,以 tokens 为准)、`--purple-*`。
- Produces: 后续 Plan 2 看板模块(app)的视觉与交互基准——统计带五组数字(待开始/进行中/已完成/已逾期/即将到期)、数字点击即筛选(设置对应筛选态并反映到筛选条与 URL 语义)、项目名旁百分比进度、进行中列头逾期小标。统计口径冻结:排除已完成任务、Asia/Shanghai 今天(复用 `lib/today.ts` 语义)、无项目筛选时为当前空间全范围聚合、已完成计数按看板现有「近 7 天完成」口径。

- [ ] **Step 1: 在 space-kanban-team.html 增加统计带**

位置:筛选条上方(页面描述文案与筛选条之间)。结构复用 dashboard 统计卡的既有类;五个数字用原型现役示例数据推导(与页面卡片一致,不许编造无来源数字):待开始/进行中/已完成/已逾期/即将到期(3 天内)。已逾期数字用危险色令牌,其余用墨色系。每个数字是可点击元素(`<button>` 形态,样式融入统计带),并在统计带右侧注明口径小字(如「已完成按近 7 天口径」)。

- [ ] **Step 2: 筛选条项目名旁加百分比进度 + 进行中列头逾期小标**

项目筛选选项(全部项目/官网改版/Q4 用户增长活动/移动端 2.0)旁加小型百分比(取值与 space-dashboard-team.html 各项目健康度一致:48%/62%/35% 等);「进行中」列头数量旁加逾期小标(红色,数值与统计带已逾期一致)。

- [ ] **Step 3: space-kanban-personal.html 同步**

个人空间变体做同样统计带与列头小标;项目进度仅在有项目筛选概念时出现(以个人看板现有筛选条为准,不硬造)。

- [ ] **Step 4: 交互脚本接线**

统计带按钮接现有 `data-*` 习惯(如 `data-filter="overdue"`),页面内联脚本(或 prototype.js)点击后更新筛选条显示文本与「当前筛选」行,演示"统计即筛选"。禁止引入新依赖。

- [ ] **Step 5: README 登记 + 验证**

`docs/prototypes/README.md` DOM 变更登记追加本任务条目(页面、新增元素、交互)。验证:两个页面浏览器打开无布局破损、统计带数字与卡片数据一致;`python3 -m http.server` + Playwright 截图留档于会话,不入库。

- [ ] **Step 6: Commit**

```bash
git add docs/prototypes/space-kanban-team.html docs/prototypes/space-kanban-personal.html docs/prototypes/README.md
git commit -m "feat(prototypes): add kanban stat strip with filter-on-click"
```

---

### Task 2: shadcn 地基与原子组件(Phase 1)

**Files:**
- Create: `apps/web/src/components/ui/shadcn/` 下:button.tsx, badge.tsx, alert.tsx, input.tsx, label.tsx, textarea.tsx, select.tsx, dialog.tsx, alert-dialog.tsx, dropdown-menu.tsx, checkbox.tsx, switch.tsx, popover.tsx, tabs.tsx, progress.tsx, sheet.tsx, pagination.tsx, sonner.tsx
- Modify: `apps/web/src/app/providers.tsx`(仅挂 `<Toaster />`,其余不动)
- Modify: `apps/web/package.json`(新依赖)
- Test: 既有全量套件 + e2e 冒烟(无新增测试文件;本任务交付物是 vendored 组件,验证为构建绿 + 页面零回归)

**Interfaces:**
- Consumes: `tokens.css` 语义变量;`docs/prototypes/README.md` shadcn/@theme 映射表;next-intl(sonner.tsx 不含文案)。
- Produces: `@/components/ui/shadcn/<name>` 导出的官方 API 组件(Button/Badge/Alert/Input/Label/Textarea/Select/Dialog/AlertDialog/DropdownMenu/Checkbox/Switch/Popover/Tabs/Progress/Sheet/Pagination),后续所有模块任务消费;`sonner.tsx` 导出 `<Toaster />`。组件实现要求:样式类引用 tokens.css 既有变量(Tailwind 任意值语法如 `bg-[var(--purple-600)]` 或在文件内定义常量类),-radix 依赖按需 `pnpm --filter @open-doing/web add @radix-ui/react-*`。

- [ ] **Step 1: 安装基础依赖**

```bash
pnpm --filter @open-doing/web add react-hook-form zod sonner next-themes
```
(next-themes 仅 sonner 官方包装需要;若 vendor 时可避免则不装,以省依赖为先——实现者按 sonner.tsx 源码决定,装了没用就在本任务内移除。)

- [ ] **Step 2: vendor 原子组件(第一批:无 radix 依赖)**

从 shadcn/ui 官方源码手工拷入 button/badge/alert/input/label/textarea/progress,逐个把色板类替换为 tokens.css 变量(映射表见 README),尺寸类保留官方默认(h-9 等,验收线允许)。每个文件头注释标明来源版本与适配说明。

- [ ] **Step 3: vendor radix 系组件(第二批)**

先装对应 `@radix-ui/react-{dialog,alert-dialog,dropdown-menu,checkbox,switch,popover,tabs,pagination}`(pagination 若官方实现不依赖 radix 则跳过),再拷入 select/dialog/alert-dialog/dropdown-menu/checkbox/switch/popover/tabs/sheet/pagination,同样做令牌替换。Sheet 同源 dialog(side 变体)。

- [ ] **Step 4: 挂载 sonner Toaster**

`providers.tsx` 的最外层(antd 包裹之外)加 `<Toaster position="bottom-right" richColors={false} />`——位置对齐原型 Task 8 演示(右下角);主题色用默认,不加定制。不改 Providers 其余任何逻辑。

- [ ] **Step 5: 全量验证**

```bash
pnpm build && pnpm typecheck && pnpm lint
set -a; source apps/web/.env.local; set +a; pnpm test
# e2e(先停 dev server):
pnpm --filter @open-doing/web exec playwright install chromium  # 仅首次
pnpm --filter @open-doing/web test:e2e -- flows/12-en-locale-smoke.spec.ts
```
Expected: 全绿;任何页面无样式回归(本任务不换用任何新组件于页面,理论上零影响——若 e2e/页面回归,是 Providers 改动引入,修复而不是绕过)。

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/components/ui/shadcn apps/web/src/app/providers.tsx apps/web/package.json pnpm-lock.yaml
git commit -m "feat(ui): vendor shadcn primitives on existing tokens and mount sonner"
```

---

### Task 3: auth 迁移试点(RHF+zod 全链路)

**Files:**
- Create: `apps/web/src/lib/action-form.ts` + `apps/web/src/lib/action-form.test.ts`
- Modify: `apps/web/src/features/auth/components/LoginForm.tsx`
- Modify: `apps/web/src/features/auth/components/RegisterForm.tsx`
- Modify: `apps/web/src/app/not-found.tsx`(antd Result → 自写空态)
- Test: `apps/web/src/lib/action-form.test.ts`

**Interfaces:**
- Consumes: Task 2 的 shadcn Button/Input/Alert/Label;`loginAction`/`registerAction` 的 `ActionResult`(`{ ok: true, data } | { ok: false, errors: { form?: string; [field: string]: string | undefined } }`,以 `features/auth/actions.ts` 实际签名为准,实现者先读)。
- Produces: **`applyActionErrors`——Plan 2 所有表单模块消费的约定**:

```ts
// apps/web/src/lib/action-form.ts
/** Server Action 错误对象:form 级 + 任意字段级,值均为文案字符串。 */
export interface ActionErrors {
  form?: string;
  [field: string]: string | undefined;
}
/**
 * 把 ActionResult.errors 应用到 RHF 表单:字段错误 → setError(name, { message }),
 * form 错误 → onFormError(message)。返回 true 表示有错误被应用(调用方据此跳过导航)。
 */
export function applyActionErrors(
  errors: ActionErrors,
  apply: { setFieldError(name: string, message: string): void; onFormError(message: string): void },
): boolean;
```
语义:`form` 键路由到 `onFormError`;空值/`ok` 后的 undefined 跳过;同一字段只设第一条;至少应用一条返回 true。

- [ ] **Step 1: 写 applyActionErrors 的失败测试**

```ts
// apps/web/src/lib/action-form.test.ts
import { describe, expect, it, vi } from "vitest";
import { applyActionErrors } from "./action-form";

describe("applyActionErrors", () => {
  it("routes field errors to setFieldError and form error to onFormError", () => {
    const setFieldError = vi.fn();
    const onFormError = vi.fn();
    const applied = applyActionErrors(
      { form: "登录失败,请重试", username: "用户名或密码错误", password: undefined },
      { setFieldError, onFormError },
    );
    expect(applied).toBe(true);
    expect(setFieldError).toHaveBeenCalledWith("username", "用户名或密码错误");
    expect(setFieldError).not.toHaveBeenCalledWith("password", expect.anything());
    expect(onFormError).toHaveBeenCalledWith("登录失败,请重试");
  });

  it("returns false when there is nothing to apply", () => {
    const setFieldError = vi.fn();
    const onFormError = vi.fn();
    expect(applyActionErrors({}, { setFieldError, onFormError })).toBe(false);
    expect(setFieldError).not.toHaveBeenCalled();
    expect(onFormError).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: 运行确认失败**

```bash
set -a; source apps/web/.env.local; set +a
pnpm vitest run apps/web/src/lib/action-form.test.ts
```
Expected: FAIL,`action-form` 模块不存在。

- [ ] **Step 3: 实现 applyActionErrors**

按上述签名实现;遍历 `Object.entries`,跳过 `form` 键与 undefined,逐个 `setFieldError`;有 form 则 `onFormError`。纯函数,不依赖 React。

- [ ] **Step 4: 运行测试确认通过**

同 Step 2 命令。Expected: 2 个测试 PASS。

- [ ] **Step 5: 重写 LoginForm**

antd Form → RHF:`useForm` + zodResolver,zod schema 在组件内构建(必填文案取 `t("usernameRequired")` 等,next-intl);字段错误用 `formState.errors.xxx.message` 渲染到字段下方(带 `aria-invalid` 与 `aria-describedby` 指向错误元素 id);action 返回 `ok:false` 时调 `applyActionErrors`;提交中 `disabled` + spinner(参照 shadcn Button loading 惯例,按钮文案不变)。保留:全部 `data-testid`、`autoComplete`、`autoFocus`、成功后 `router.push(spaceDashboardHref("personal")) + router.refresh()`。布局结构与文案对照 `docs/prototypes/login.html`(渐变主按钮、间距节奏)。

- [ ] **Step 6: 重写 RegisterForm**

同模式;schema 用 `.refine` 做两次密码一致校验(错误文案用现有 register 相关 i18n 键;若缺,按 register.html 原型文案补 zh+en);password2 错误渲染在字段旁。保留既有 data-testid 与 autoComplete 语义(`new-password`)。

- [ ] **Step 7: not-found.tsx 去 antd**

antd Result → 简单居中空态(标题 + 说明 + 返回首页 Link),令牌取自 tokens.css;文案沿用现有 i18n 键(先读现有文件确认键名,不新造)。无对应原型页,形态克制即可。

- [ ] **Step 8: i18n 与全量测试**

新增文案(如有)补 zh/en;跑:
```bash
pnpm build && pnpm typecheck && pnpm lint
set -a; source apps/web/.env.local; set +a; pnpm test
```
Expected: 全绿(含 cjk-guard、messages-parity)。

- [ ] **Step 9: e2e + 手动走查**

停 dev server 后:
```bash
pnpm --filter @open-doing/web test:e2e -- flows/01-personal-task-subtask.spec.ts
pnpm --filter @open-doing/web test:e2e -- flows/12-en-locale-smoke.spec.ts
```
Expected: PASS(e2e 走登录,证明新登录表单全链路可用、data-testid 未破坏)。
重启 dev server,Playwright 手动走查:①登录页与 `docs/prototypes/login.html` 并排截图对照;②错误路径——错误密码提交,字段级错误出现在对应输入下方;③注册页 password2 不一致,错误带 aria-describedby;④提交中按钮禁用 + spinner;⑤en locale 下两页文案为英文。走查发现的偏差就地修复后重跑本步。

- [ ] **Step 10: Commit**

```bash
git add apps/web/src/lib/action-form.ts apps/web/src/lib/action-form.test.ts apps/web/src/features/auth/components apps/web/src/app/not-found.tsx apps/web/src/i18n/messages
git commit -m "feat(auth): migrate forms to react-hook-form + zod and shadcn primitives"
```
