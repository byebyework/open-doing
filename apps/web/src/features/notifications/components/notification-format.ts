import type { TranslateFn } from "@/i18n/translate";

import type { NotificationListItem } from "../queries";

/** 通知文案片段：`bold` 对应原型中的 `<b>` 语义。 */
export interface NotificationBody {
  parts: { text: string; bold: boolean }[];
}

/**
 * 解析句中粗体标记：`加粗<b>重点</b>文本` → `[{text:"加粗",bold:false}, …]`。
 *
 * 模板里用 `<b>…</b>` 标记加粗区间（如「已逾期」、英文语序下的重排位置），
 * 渲染端仍消费现有的 `{parts: [{text, bold}]}` 结构，零改动。
 * 连续标签之间不产生空片段；无标记文本整体为一个普通片段。
 */
export function parseBoldSegments(text: string): NotificationBody["parts"] {
  const parts: NotificationBody["parts"] = [];
  const pattern = /<b>(.*?)<\/b>/g;
  let cursor = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > cursor) {
      parts.push({ text: text.slice(cursor, match.index), bold: false });
    }
    parts.push({ text: match[1]!, bold: true });
    cursor = match.index + match[0].length;
  }

  if (cursor < text.length) {
    parts.push({ text: text.slice(cursor), bold: false });
  }

  return parts;
}

/**
 * 组装「触发者（粗体） + 陈述句」文案。
 *
 * cron 类通知没有触发者（`actorName=null`），此时去掉主体、直接从陈述句开始，
 * 例如「你负责的「X」已逾期」，避免出现「系统」之类的虚构主体。
 */
function withActor(actorName: string | null, rest: string): NotificationBody {
  if (!actorName) {
    return { parts: [{ text: rest, bold: false }] };
  }

  return {
    parts: [
      { text: actorName, bold: true },
      { text: ` ${rest}`, bold: false },
    ],
  };
}

/**
 * 通知列表项 → 富文本片段（纯函数，无 IO，可直接在客户端组件中调用）。
 *
 * 文案取自 `notifications` 命名空间（`t` 由调用方按当前语言构造）：
 * - 有触发者的类型加粗触发者（与原型 `docs/prototypes/my-tasks.html` 的
 *   `notif-pop` 一致）；
 * - `task_due_soon` / `task_overdue` 为无主体陈述句，前者不区分今天/明天
 *   （通知读模型没有截止日期字段），后者通过句中 `<b>` 标记只加粗「已逾期」。
 *
 * 注意：`NotificationListItem` 仅以 `import type` 引入，编译期即被擦除，
 * 不会把 `../queries`（依赖数据库连接）带进客户端 bundle。
 */
export function formatNotificationBody(
  item: NotificationListItem,
  t: TranslateFn,
): NotificationBody {
  const taskTitle = item.taskTitle ?? t("unknownTask");
  const teamName = item.teamName ?? t("unknownTeam");

  switch (item.type) {
    case "team_invite":
      return withActor(item.actorName, t("invite", { team: teamName }));
    case "team_join_requested":
      return withActor(item.actorName, t("joinRequested", { team: teamName }));
    case "team_join_approved":
      return withActor(item.actorName, t("joinApproved", { team: teamName }));
    case "team_join_declined":
      return withActor(item.actorName, t("joinDeclined", { team: teamName }));
    case "task_assigned":
      return withActor(item.actorName, t("assigned", { task: taskTitle }));
    case "task_due_soon":
      return { parts: parseBoldSegments(t("dueSoon", { task: taskTitle })) };
    case "task_overdue":
      return { parts: parseBoldSegments(t("overdue", { task: taskTitle })) };
    case "task_commented":
      return withActor(item.actorName, t("commented", { task: taskTitle }));
    case "task_changed_by_admin":
      return withActor(item.actorName, t("changedByAdmin", { task: taskTitle }));
    default:
      // 运行时兜底：服务端新增未知类型时不渲染空白以外的错误文案。
      return { parts: [] };
  }
}
