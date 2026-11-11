import { isDueSoon, isOverdue, type TaskStatus } from "@open-doing/types";
import { useTranslations } from "next-intl";

import { formatTaskDate } from "@/lib/date-display";

/** DueText 入参。 */
export interface DueTextProps {
  /** 截止日期，`YYYY-MM-DD`；缺省时不渲染。 */
  dueDate?: string;
  /** 任务状态：已完成的任务不再标红/标黄。 */
  status: TaskStatus;
  /** 今天，`YYYY-MM-DD`（由调用方传入，保证服务端/客户端判定一致）。 */
  today: string;
}

/**
 * 截止日期文案（spec D10）：逾期红「已逾期 · YYYY-MM-DD」/ 临期黄 / 普通灰，
 * 一律显示完整绝对日期，无「今天 / 明天」相对文案。
 * 无截止日期时返回 null（调用方自行决定占位）。
 */
export function DueText({ dueDate, status, today }: DueTextProps) {
  const t = useTranslations("date");
  if (!dueDate) {
    return null;
  }

  if (isOverdue(dueDate, status, today)) {
    return (
      <span
        className="inline-flex items-center whitespace-nowrap text-[12.5px] font-semibold text-[var(--status-overdue)]"
        title={dueDate}
      >
        {t("overdueWithDate", { date: formatTaskDate(dueDate) })}
      </span>
    );
  }

  if (isDueSoon(dueDate, status, today)) {
    return (
      <span
        className="inline-flex items-center whitespace-nowrap text-[12.5px] font-semibold text-[#a66b00]"
        title={dueDate}
      >
        {formatTaskDate(dueDate)}
      </span>
    );
  }

  return (
    <span
      className="inline-flex items-center whitespace-nowrap text-[12.5px] text-[var(--ink-500)]"
      title={dueDate}
    >
      {formatTaskDate(dueDate)}
    </span>
  );
}
