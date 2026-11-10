import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * 防硬编码中文守卫（i18n 计划 Task 21）。
 *
 * 遍历 `apps/web/src` 与 `apps/web/e2e` 的 .ts/.tsx（排除 *.test.* 与
 * i18n/messages/**），剥掉注释后仍含 CJK 即失败并列出 file:line。
 * 文案必须走 next-intl 消息包；白名单内是**非 UI 文案**或**刻意中文**的存量，
 * 按类别给出理由（brief 要求逐个给出）。
 */

/** src 白名单：文件前缀 → 理由（非 UI 文案或刻意中文）。 */
const SRC_WHITELIST: ReadonlyArray<{ prefix: string; reason: string }> = [
  // ── DomainError / *Error 系 zh 兜底 ──
  // 错误类构造时携带 { key, params } i18n 通道，客户端按 key 渲染；
  // 构造参数里的中文只是服务端兜底 message（lib/domain-failure.ts），
  // 从不直接展示给用户。校验辅助里的 "任务"/"子任务" 是消息构造的区分标签。
  ...[
    "apps/web/src/features/auth/constants.ts",
    "apps/web/src/features/auth/service.ts",
  ].map((prefix) => ({ prefix, reason: "AuthError zh 兜底（constants 为 message 常量，均携带 i18n key）" })),
  { prefix: "apps/web/src/features/users/service.ts", reason: "UserError zh 兜底（构造参数均携带 users.profile i18n key）" },
  { prefix: "apps/web/src/features/personal/tasks/service.ts", reason: "DomainError zh 兜底 + 校验标签" },
  { prefix: "apps/web/src/features/personal/projects/service.ts", reason: "DomainError zh 兜底" },
  { prefix: "apps/web/src/features/projects/service.ts", reason: "DomainError zh 兜底" },
  { prefix: "apps/web/src/features/tasks/service.ts", reason: "DomainError zh 兜底 + 校验标签" },
  { prefix: "apps/web/src/features/tasks/permissions.ts", reason: "TaskPermissionError zh 兜底（action 层按 errors.forbidden 渲染）" },
  { prefix: "apps/web/src/features/teams/service.ts", reason: "TeamError zh 兜底" },
  { prefix: "apps/web/src/features/teams/permissions.ts", reason: "TeamPermissionError zh 兜底（action 层按 errors.forbidden 渲染）" },
  { prefix: "apps/web/src/features/teams/joins/service.ts", reason: "JoinError zh 兜底" },
  { prefix: "apps/web/src/features/teams/invites/service.ts", reason: "InviteError zh 兜底" },
  { prefix: "apps/web/src/features/teams/members/service.ts", reason: "Member/Policy/GovernanceError zh 兜底" },
  { prefix: "apps/web/src/lib/task-fields.ts", reason: "DomainError zh 兜底 + 校验标签" },

  // ── Server Action / 客户端 console.error 日志前缀 ──
  // 面向开发者的服务端日志，无 UI。
  ...[
    "apps/web/src/features/auth/actions.ts",
    "apps/web/src/features/kanban/actions.ts",
    "apps/web/src/features/notifications/actions.ts",
    "apps/web/src/features/notifications/components/NotificationBell.tsx",
    "apps/web/src/features/personal/projects/actions.ts",
    "apps/web/src/features/personal/tasks/actions.ts",
    "apps/web/src/features/projects/actions.ts",
    "apps/web/src/features/tasks/actions.ts",
    "apps/web/src/features/teams/actions.ts",
    "apps/web/src/features/teams/invites/actions.ts",
    "apps/web/src/features/teams/joins/actions.ts",
    "apps/web/src/features/teams/members/actions.ts",
    "apps/web/src/features/users/actions.ts",
  ].map((prefix) => ({ prefix, reason: "console.error 服务端日志前缀" })),

  // updateLanguageAction 的非法语言值兜底：UI 的 Select 只提供 zh/en，
  // 该分支仅直连调用（篡改入参）可达，无正常英文用户路径。
  { prefix: "apps/web/src/features/users/actions.ts", reason: "console.error 前缀 + 不可达的非法语言兜底" },

  // ── 启动期 / 环境错误（开发者面向，进程级 throw，无 UI） ──
  { prefix: "apps/web/src/features/auth/server.ts", reason: "BETTER_AUTH_SECRET 缺失的启动期 throw" },
  { prefix: "apps/web/src/server/db/client.ts", reason: "DATABASE_URL 缺失启动期 throw" },
  { prefix: "apps/web/src/server/db/testing.ts", reason: "TEST_DATABASE_URL 缺失启动期 throw" },
  { prefix: "apps/web/src/lib/slug.ts", reason: "slug 冲突超限的进程级 throw" },

  // ── 刻意中文数据 ──
  // 种子示例数据是内容本身；zh 日历短星期是 dayjs locale 数据；
  // 语言名用各自母语展示（用户看不懂当前语言时也要找得到入口）。
  { prefix: "apps/web/src/server/db/seed.ts", reason: "种子示例数据内容" },
  { prefix: "apps/web/src/features/calendar/components/SpaceCalendar.tsx", reason: "ZH_CALENDAR_LOCALE 短星期数据" },
  { prefix: "apps/web/src/features/users/components/LanguageSetting.tsx", reason: "语言名母语展示「简体中文」" },
  { prefix: "apps/web/src/features/landing/components/LanguageSwitch.tsx", reason: "语言按钮的母语短标识「中」（同 LanguageSetting 惯例，语言名本身不翻译）" },

  // ── Route Handler（无 UI：日志与 cron 兜底文案） ──
  { prefix: "apps/web/src/app/api/", reason: "API 日志与 cron 兜底文案，无 UI" },
];

/** e2e 白名单：文案本身是被测行为（默认 zh locale 下运行的可见文本断言）。 */
const E2E_WHITELIST: ReadonlyArray<{ prefix: string; reason: string }> = [
  { prefix: "apps/web/e2e/utils/", reason: "辅助函数中的 zh toast 断言（项目已创建）" },
  { prefix: "apps/web/e2e/flows/01-personal-task-subtask.spec.ts", reason: "任务/子任务 zh 文案断言" },
  { prefix: "apps/web/e2e/flows/02-team-invite.spec.ts", reason: "邀请流 zh 文案断言" },
  { prefix: "apps/web/e2e/flows/03-kanban-drag.spec.ts", reason: "看板列头/拖拽 zh 断言" },
  { prefix: "apps/web/e2e/flows/04-cron-reminder.spec.ts", reason: "通知正文 zh 断言" },
  { prefix: "apps/web/e2e/flows/05-dissolve-team.spec.ts", reason: "解散团队 zh 文案断言" },
  { prefix: "apps/web/e2e/flows/06-space-kanban.spec.ts", reason: "空间看板 zh 文案断言" },
  { prefix: "apps/web/e2e/flows/07-space-calendar.spec.ts", reason: "空间日历 zh 文案断言" },
  { prefix: "apps/web/e2e/flows/08-space-analysis.spec.ts", reason: "分析页统计标签 zh 断言" },
  { prefix: "apps/web/e2e/flows/09-personal-settings.spec.ts", reason: "设置页 zh 文案断言" },
  { prefix: "apps/web/e2e/flows/10-team-join-by-code.spec.ts", reason: "凭码加入 zh 文案断言" },
  { prefix: "apps/web/e2e/flows/11-space-switching.spec.ts", reason: "空间切换 zh 文案断言" },
  { prefix: "apps/web/e2e/flows/12-en-locale-smoke.spec.ts", reason: "中文 describe/test 标题 + 「简体中文」语言名母语选项" },
  { prefix: "apps/web/e2e/responsive.spec.ts", reason: "响应式路由 zh 就绪断言" },
];

const CJK = /[一-鿿]/;

const SCAN_ROOTS = [
  join(import.meta.dirname, ".."),
  join(import.meta.dirname, "../../e2e"),
];

function isWhitelisted(file: string): boolean {
  return [...SRC_WHITELIST, ...E2E_WHITELIST].some((entry) =>
    file.startsWith(entry.prefix),
  );
}

function* walk(dir: string): Generator<string> {
  for (const name of readdirSync(dir)) {
    if (name.endsWith(".test.ts") || name.endsWith(".test.tsx")) continue;
    const full = join(dir, name);
    if (full.endsWith(join("i18n", "messages"))) continue;
    if (name.endsWith(".ts") || name.endsWith(".tsx")) yield full;
    if (!name.includes(".")) yield* walk(full);
  }
}

/** 逐行剥注释（跨行块注释用状态位），返回仍含 CJK 的行号列表。 */
function cjkLines(content: string): number[] {
  const hits: number[] = [];
  let inBlock = false;
  for (const [index, rawLine] of content.split("\n").entries()) {
    let line = rawLine;
    if (inBlock) {
      const end = line.indexOf("*/");
      if (end === -1) continue;
      line = line.slice(end + 2);
      inBlock = false;
    }
    line = line.replace(/\/\*[\s\S]*?\*\//g, "");
    const blockStart = line.indexOf("/*");
    if (blockStart !== -1) {
      line = line.slice(0, blockStart);
      inBlock = true;
    }
    // 剥行注释；[^:] 避免误伤字符串里的 https:// 等协议双斜杠。
    line = line.replace(/(^|[^:])\/\/.*$/, "$1");
    if (CJK.test(line)) hits.push(index + 1);
  }
  return hits;
}

describe("cjk guard", () => {
  it("src 与 e2e 的源码剥注释后不含白名单外的硬编码中文", () => {
    const offenders: string[] = [];
    for (const root of SCAN_ROOTS) {
      for (const file of walk(root)) {
        const relative = file.slice(file.indexOf("apps/web/"));
        if (isWhitelisted(relative)) continue;
        const lines = cjkLines(readFileSync(file, "utf8"));
        for (const line of lines) offenders.push(`${relative}:${line}`);
      }
    }
    expect(
      offenders,
      `硬编码中文残留（走 next-intl 消息包，或按理由加入白名单）:\n${offenders.join("\n")}`,
    ).toEqual([]);
  });
});
