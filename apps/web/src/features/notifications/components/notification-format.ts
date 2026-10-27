import type { NotificationListItem } from "../queries";

/** 通知文案片段：`bold` 对应原型中的 `<b>` 语义。 */
export interface NotificationBody {
  parts: { text: string; bold: boolean }[];
}

/** 关联对象缺失时的占位文案（读模型字段可为 null）。 */
const TASK_FALLBACK = "未知任务";
const TEAM_FALLBACK = "未知团队";

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
 * 文案对齐原型 `docs/prototypes/my-tasks.html` 的 `notif-pop`：
 * - 有触发者的类型加粗触发者；
 * - `task_due_soon` / `task_overdue` 为无主体陈述句，前者不区分今天/明天
 *   （通知读模型没有截止日期字段），后者只加粗「已逾期」。
 *
 * 注意：`NotificationListItem` 仅以 `import type` 引入，编译期即被擦除，
 * 不会把 `../queries`（依赖数据库连接）带进客户端 bundle。
 */
export function formatNotificationBody(item: NotificationListItem): NotificationBody {
  const taskTitle = item.taskTitle ?? TASK_FALLBACK;
  const teamName = item.teamName ?? TEAM_FALLBACK;

  switch (item.type) {
    case "team_invite":
      return withActor(item.actorName, `邀请你加入团队「${teamName}」`);
    case "team_join_requested":
      return withActor(item.actorName, `申请加入团队「${teamName}」`);
    case "team_join_approved":
      return withActor(item.actorName, `通过了你加入「${teamName}」的申请`);
    case "team_join_declined":
      return withActor(item.actorName, `拒绝了你加入「${teamName}」的申请`);
    case "task_assigned":
      return withActor(item.actorName, `把「${taskTitle}」指派给你`);
    case "task_due_soon":
      return {
        parts: [{ text: `你负责的「${taskTitle}」今日/明日到期`, bold: false }],
      };
    case "task_overdue":
      return {
        parts: [
          { text: `你负责的「${taskTitle}」`, bold: false },
          { text: "已逾期", bold: true },
        ],
      };
    case "task_commented":
      return withActor(item.actorName, `评论了「${taskTitle}」`);
    case "task_changed_by_admin":
      return withActor(item.actorName, `更新了你负责的「${taskTitle}」`);
    default:
      // 运行时兜底：服务端新增未知类型时不渲染空白以外的错误文案。
      return { parts: [] };
  }
}
