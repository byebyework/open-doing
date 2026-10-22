import { isDueSoon, isOverdue, type TaskStatus } from "@open-doing/types";

/** DueText 入参。 */
export interface DueTextProps {
  /** 截止日期，`YYYY-MM-DD`；缺省时不渲染。 */
  dueDate?: string;
  /** 任务状态：已完成的任务不再标红/标黄。 */
  status: TaskStatus;
  /** 今天，`YYYY-MM-DD`（由调用方传入，保证服务端/客户端判定一致）。 */
  today: string;
}

/** 将 `YYYY-MM-DD` 显示为原型同款 `MM-DD`。 */
function shortDate(date: string): string {
  return /^\d{4}-\d{2}-\d{2}$/.test(date) ? date.slice(5) : date;
}

/**
 * 截止日期文案：逾期红 / 临期黄 / 普通灰。
 *
 * 逾期显示「已逾期 · MM-DD」；今天/明天到期显示「今天」「明天」；
 * 其余显示 `MM-DD`。无截止日期时返回 null（调用方自行决定占位）。
 */
export function DueText({ dueDate, status, today }: DueTextProps) {
  if (!dueDate) {
    return null;
  }

  if (isOverdue(dueDate, status, today)) {
    return (
      <span
        className="inline-flex items-center whitespace-nowrap text-[12.5px] font-semibold text-[#ff5757]"
        title={dueDate}
      >
        已逾期 · {shortDate(dueDate)}
      </span>
    );
  }

  if (isDueSoon(dueDate, status, today)) {
    return (
      <span
        className="inline-flex items-center whitespace-nowrap text-[12.5px] font-semibold text-[#a66b00]"
        title={dueDate}
      >
        {dueDate === today ? "今天" : "明天"}
      </span>
    );
  }

  return (
    <span
      className="inline-flex items-center whitespace-nowrap text-[12.5px] text-[#5f6368]"
      title={dueDate}
    >
      {shortDate(dueDate)}
    </span>
  );
}
