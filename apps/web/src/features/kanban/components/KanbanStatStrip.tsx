"use client";

import { addDays } from "@open-doing/types";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";

import type { TaskStatus } from "@open-doing/types";

import type { KanbanStats } from "../service";

/** 统计带入参（RSC 传入统计数与激活态，点击行为下沉到本客户端组件）。 */
export interface KanbanStatStripProps {
  stats: KanbanStats;
  /** 今天（Asia/Shanghai，`YYYY-MM-DD`），供临期窗口 delta 文案。 */
  today: string;
  /** 当前 URL 命中的统计筛选（chips 的激活态）。 */
  active: {
    status?: TaskStatus;
    overdue?: boolean;
    dueSoon?: boolean;
  };
  /** 空间 Kanban 基路径（query 在其上重写）。 */
  basePath: string;
  /** 重写 URL 时必须保留的既有筛选参数（project / assignee）。 */
  preserveParams: Record<string, string>;
}

/** chip 定义：URL 参数与原型 data-filter 的映射。 */
interface StatChip {
  filter: string;
  param: "status" | "overdue" | "dueSoon";
  /** 写入 URL 的值（status chip 用状态名，布尔 chip 用 "1"）。 */
  paramValue: string;
  label: string;
  value: number;
  delta: string;
  valueClass?: string;
}

/** chip 卡片外壳（对照原型 `.card .stat`：描边圆角卡、左对齐三行）。 */
const CHIP_CLASS =
  "rounded-xl border border-[#e1e3e6] bg-white px-4 py-3 text-left shadow-[0_1px_3px_rgba(14,19,24,0.04)] transition-colors hover:border-[var(--primary)]";

/**
 * 看板统计带（对照 `space-kanban-*.html` 的 `.kb-stats`）。
 *
 * 统计即筛选：点击 chip 切换视角，一次只激活一个（再点取消），RSC 按
 * 新参数重新取数；激活 chip 以 aria-pressed 标记（原型同款描边高亮）。
 * project / assignee 是视角内细化，经 preserveParams 保留。
 */
export function KanbanStatStrip({
  stats,
  today,
  active,
  basePath,
  preserveParams,
}: KanbanStatStripProps) {
  const router = useRouter();
  const t = useTranslations("kanban");

  const chips: StatChip[] = [
    {
      filter: "status:todo",
      param: "status",
      paramValue: "todo",
      label: t("statTodo"),
      value: stats.todo,
      delta: t("statTodoDelta"),
    },
    {
      filter: "status:in_progress",
      param: "status",
      paramValue: "in_progress",
      label: t("statInProgress"),
      value: stats.inProgress,
      delta: t("statInProgressDelta", { count: stats.overdue }),
    },
    {
      filter: "status:done",
      param: "status",
      paramValue: "done",
      label: t("statDone"),
      value: stats.doneRecent,
      delta: t("statDoneDelta", { count: stats.doneRecent }),
    },
    {
      filter: "overdue",
      param: "overdue",
      paramValue: "1",
      label: t("statOverdue"),
      value: stats.overdue,
      delta: t("statOverdueDelta"),
      valueClass: "text-[var(--error)]",
    },
    {
      filter: "due-soon",
      param: "dueSoon",
      paramValue: "1",
      label: t("statDueSoon"),
      value: stats.dueSoon,
      delta: t("statDueSoonDelta", { start: today, end: addDays(today, 3) }),
      valueClass: "text-[#a66b00]",
    },
  ];

  function isActive(chip: StatChip): boolean {
    if (chip.param === "status") return active.status === chip.paramValue;
    if (chip.param === "overdue") return active.overdue === true;
    return active.dueSoon === true;
  }

  /** 点击即筛选：激活中的 chip 再点一次即取消（参数删除 → 干净地址）。 */
  function toggle(chip: StatChip) {
    const params = new URLSearchParams(preserveParams);

    if (isActive(chip)) {
      params.delete(chip.param);
    } else {
      params.set(chip.param, chip.paramValue);
    }

    const query = params.toString();
    router.push(query ? `${basePath}?${query}` : basePath);
  }

  return (
    <div className="mt-5">
      <div className="mb-2 text-right text-[12px] text-[#5f6368]">
        {t("statsCaption")}
      </div>
      <div className="grid grid-cols-2 gap-3 min-[481px]:grid-cols-3 min-[861px]:grid-cols-5">
        {chips.map((chip) => {
          const pressed = isActive(chip);

          return (
            <button
              key={chip.filter}
              type="button"
              data-filter={chip.filter}
              aria-pressed={pressed}
              onClick={() => toggle(chip)}
              className={`${CHIP_CLASS} ${
                pressed
                  ? "border-[var(--primary)] shadow-[inset_0_0_0_1px_var(--primary)]"
                  : ""
              }`}
            >
              <div className="text-[12.5px] font-medium text-[#5f6368]">
                {chip.label}
              </div>
              <div
                className={`my-1.5 text-[26px] font-extrabold leading-[1.1] tracking-[-0.02em] ${
                  chip.valueClass ?? "text-[#0e1318]"
                }`}
              >
                {chip.value}
              </div>
              <div className="text-[12px] text-[#9aa0a6]">{chip.delta}</div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
