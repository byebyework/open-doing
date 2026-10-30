"use client";

import { addDays } from "@open-doing/types";
import { Calendar } from "antd";
import dayjs, { type Dayjs } from "dayjs";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

import { daysBetween, getWeekStart, weekdayLabel } from "@/lib/today";

import type { CalendarTaskItem, SpaceCalendarData } from "../service";

/** 空间日历入参（个人 / 团队共用，团队专有入口由 variant 决定）。 */
export interface SpaceCalendarProps {
  variant: "personal" | "team";
  /** 所显示月份 "YYYY-MM"（页面已校验） */
  month: string;
  /** YYYY-MM-DD，服务端注入 */
  today: string;
  data: SpaceCalendarData;
  /** taskId → 详情页 href（页面构造；缺 href 的任务不渲染为链接） */
  taskHrefs: Record<string, string>;
  /** 模块根路径，翻月 push `${basePath}?month=YYYY-MM` */
  basePath: string;
  /** 「N 项任务没有截止日期 →」的跳转 href；仅 variant=personal 使用 */
  noDueHref?: string;
}

/** 「本月即将到期」默认展示条数（其余折叠）。 */
const UPCOMING_PREVIEW = 5;

/** 单格最多展示的 chip 数，溢出显示「还有 K 项」。 */
const CELL_CHIP_LIMIT = 3;

/** 负责人头像定色盘（含原型示例色：林紫 / 何蓝 / 苏粉）。 */
const ASSIGNEE_COLORS = [
  "#7d2ae8",
  "#0088ff",
  "#e91e63",
  "#00b894",
  "#ff9633",
  "#9b87f5",
] as const;

/** 到期紧迫度：决定 chip / 状态点 / meta 配色。 */
type Tone = "done" | "overdue" | "today" | "soon" | "later";

/** chip 配色（hex 取自 space-calendar-*.html 的 CSS block）。 */
const CHIP_TONE_CLASS: Record<Tone, string> = {
  done: "bg-[#e3f4e8] text-[#1f9d78]",
  overdue: "bg-[rgba(255,87,87,0.1)] text-[#ff5757]",
  today: "bg-[#fff3cd] text-[#8a5800]",
  soon: "bg-[#ffe9d6] text-[#b35400]",
  later: "bg-[#f1f3f4] text-[#5f6368]",
};

/** 侧栏状态点颜色。 */
const DOT_COLOR: Record<Tone, string> = {
  done: "#1f9d78",
  overdue: "#ff5757",
  today: "#a66b00",
  soon: "#b35400",
  later: "#5f6368",
};

/** 用户名哈希：同一负责人恒定映射到同一头像底色。 */
function hashName(name: string): number {
  let hash = 0;

  for (const char of name) {
    hash = (hash * 31 + (char.codePointAt(0) ?? 0)) >>> 0;
  }

  return hash;
}

/** 负责人头像底色（定色盘，非 antd 头像）。 */
function assigneeColor(name: string): string {
  return ASSIGNEE_COLORS[hashName(name) % ASSIGNEE_COLORS.length]!;
}

/** `YYYY-MM-DD` → 原型口径的 `MM-DD`。 */
function shortDate(date: string): string {
  return /^\d{4}-\d{2}-\d{2}$/.test(date) ? date.slice(5) : date;
}

/** 任务紧迫度（done 优先，不按逾期着色）。 */
function toneOf(item: CalendarTaskItem, today: string): Tone {
  if (item.done) return "done";

  const diff = daysBetween(today, item.dueDate);
  if (diff < 0) return "overdue";
  if (diff === 0) return "today";
  if (diff <= 3) return "soon";

  return "later";
}

/** 本周清单条目的右侧 meta（done「已完成」/ 逾期 / 今天 / 倒计时）。 */
function weekMeta(
  item: CalendarTaskItem,
  today: string,
): { text: string; className: string } {
  if (item.done) {
    return { text: "已完成", className: "text-[#9aa0a6]" };
  }

  const diff = daysBetween(today, item.dueDate);

  if (diff < 0) {
    return { text: `已逾期 ${-diff} 天`, className: "text-[#ff5757]" };
  }

  if (diff === 0) {
    return { text: "今天", className: "text-[#a66b00]" };
  }

  return {
    text: `还有 ${diff} 天`,
    className: diff <= 3 ? "text-[#b35400]" : "text-[#9aa0a6]",
  };
}

/** 团队负责人头像：首字 + 定色盘底色（chip 14px / 侧栏 16px）。 */
function AssigneeBadge({
  name,
  size,
}: {
  name: string;
  size: 14 | 16;
}) {
  const firstChar = Array.from(name.trim())[0] ?? "?";

  return (
    <span
      role="img"
      aria-label={name}
      title={name}
      className="inline-flex shrink-0 select-none items-center justify-center rounded-full font-semibold text-white"
      style={{
        width: size,
        height: size,
        fontSize: size === 14 ? 9 : 9.5,
        backgroundColor: assigneeColor(name),
      }}
    >
      {firstChar}
    </span>
  );
}

/** 未指派 chip 描边 tag（颜色继承 chip 文字色，对照 `.tag-un`）。 */
function ChipUnassignedTag() {
  return (
    <span className="shrink-0 whitespace-nowrap rounded-full border border-current px-1 text-[9.5px] leading-[1.5]">
      未指派
    </span>
  );
}

/** 侧栏未指派 tag（蓝底信息色 + 前置圆点，对照 `.tag.tag-info`）。 */
function SidebarUnassignedTag() {
  return (
    <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-[rgba(13,153,255,0.1)] px-1.5 py-px text-[9.5px] font-medium text-[#0d99ff]">
      <span className="h-1.5 w-1.5 rounded-full bg-current" />
      未指派
    </span>
  );
}

/** 个人空间项目 tag（薄荷色，与 Kanban 个人卡一致）。 */
function MintProjectTag({
  name,
  className = "",
}: {
  name: string;
  className?: string;
}) {
  return (
    <span
      className={`inline-flex shrink-0 items-center rounded-full bg-[rgba(72,201,151,0.12)] px-1.5 py-px text-[10px] font-semibold text-[#1f9d78] ${className}`}
    >
      <span className="truncate">{name}</span>
    </span>
  );
}

/** 月网格单条任务 chip：负责人 / 项目前缀 + 标题，done 划线淡显。 */
function CalendarChip({
  variant,
  item,
  today,
  href,
  dimmed,
}: {
  variant: "personal" | "team";
  item: CalendarTaskItem;
  today: string;
  href?: string;
  dimmed: boolean;
}) {
  const tone = toneOf(item, today);
  const titleClassName = `min-w-0 truncate ${tone === "done" ? "line-through" : ""}`;

  return (
    <div
      className={`mt-1 flex w-fit max-w-full items-center gap-1 rounded-[5px] px-1.5 py-0.5 text-[11.5px] leading-[1.4] ${
        CHIP_TONE_CLASS[tone]
      } ${dimmed ? "opacity-[0.45]" : ""}`}
    >
      {variant === "team" ? (
        item.assigneeName ? (
          <AssigneeBadge name={item.assigneeName} size={14} />
        ) : (
          <ChipUnassignedTag />
        )
      ) : item.projectName ? (
        <MintProjectTag name={item.projectName} className="max-w-[72px]" />
      ) : null}

      {href ? (
        <Link href={href} className={`${titleClassName} hover:underline`}>
          {item.title}
        </Link>
      ) : (
        <span className={titleClassName}>{item.title}</span>
      )}
    </div>
  );
}

/** 单日格内容：最多 3 条 chip + 静态「还有 K 项」。 */
function DayCell({
  variant,
  items,
  today,
  taskHrefs,
  dimmed,
}: {
  variant: "personal" | "team";
  items: CalendarTaskItem[];
  today: string;
  taskHrefs: Record<string, string>;
  dimmed: boolean;
}) {
  const visible = items.slice(0, CELL_CHIP_LIMIT);
  const overflow = items.length - visible.length;

  return (
    <div className={`flex flex-col items-start ${dimmed ? "opacity-[0.45]" : ""}`}>
      {visible.map((item) => (
        <CalendarChip
          key={item.id}
          variant={variant}
          item={item}
          today={today}
          href={taskHrefs[item.id]}
          dimmed={false}
        />
      ))}
      {overflow > 0 ? (
        <span className="mt-1 pl-0.5 text-[11px] text-[#7d2ae8]">
          还有 {overflow} 项
        </span>
      ) : null}
    </div>
  );
}

/** 本周清单单条：状态点 + 负责人/项目 + 标题 + 右侧 meta。 */
function WeekItem({
  variant,
  item,
  today,
  href,
}: {
  variant: "personal" | "team";
  item: CalendarTaskItem;
  today: string;
  href?: string;
}) {
  const tone = toneOf(item, today);
  const meta = weekMeta(item, today);
  const titleClassName = `min-w-0 flex-1 truncate ${
    item.done ? "line-through" : ""
  }`;

  return (
    <div
      className={`flex items-center gap-1.5 py-[3px] text-[12.5px] ${
        item.done ? "text-[#9aa0a6]" : "text-[#0e1318]"
      }`}
    >
      <span
        className="h-[7px] w-[7px] shrink-0 rounded-full"
        style={{ backgroundColor: DOT_COLOR[tone] }}
      />

      {variant === "team" ? (
        item.assigneeName ? (
          <AssigneeBadge name={item.assigneeName} size={16} />
        ) : (
          <SidebarUnassignedTag />
        )
      ) : item.projectName ? (
        <MintProjectTag name={item.projectName} className="max-w-[84px]" />
      ) : null}

      {href ? (
        <Link href={href} className={`${titleClassName} hover:underline`}>
          {item.title}
        </Link>
      ) : (
        <span className={titleClassName}>{item.title}</span>
      )}

      <span
        className={`ml-auto shrink-0 whitespace-nowrap text-[11px] ${meta.className}`}
      >
        {meta.text}
      </span>
    </div>
  );
}

/** 「本月即将到期」单条：状态点 + 负责人（团队）+ 标题 + 「MM-DD · 还有 N 天」。 */
function UpcomingItem({
  variant,
  item,
  today,
  href,
}: {
  variant: "personal" | "team";
  item: CalendarTaskItem;
  today: string;
  href?: string;
}) {
  return (
    <div className="flex items-center gap-1.5 py-[3px] text-[12.5px] text-[#0e1318]">
      <span
        className="h-[7px] w-[7px] shrink-0 rounded-full"
        style={{ backgroundColor: DOT_COLOR.later }}
      />

      {variant === "team" ? (
        item.assigneeName ? (
          <AssigneeBadge name={item.assigneeName} size={16} />
        ) : (
          <SidebarUnassignedTag />
        )
      ) : null}

      {href ? (
        <Link
          href={href}
          className="min-w-0 flex-1 truncate hover:underline"
        >
          {item.title}
        </Link>
      ) : (
        <span className="min-w-0 flex-1 truncate">{item.title}</span>
      )}

      <span className="ml-auto shrink-0 whitespace-nowrap text-[11px] text-[#9aa0a6]">
        {shortDate(item.dueDate)} · 还有 {daysBetween(today, item.dueDate)} 天
      </span>
    </div>
  );
}

/**
 * 空间级 Calendar（个人 / 团队共用，对照 `space-calendar-*.html`）。
 *
 * - antd Calendar 受控于 URL 月份；`headerRender` 负责 ‹ › / 今天 的
 *   `router.push`，`cellRender` 负责按截止日期落 chip；
 * - 侧栏锚定「今天」（不随所显示月份翻动）：本周清单 + 本月即将到期；
 * - 只读：chip / 条目按 `taskHrefs` 渲染成 next/link，缺 href 时为纯文本。
 */
export function SpaceCalendar({
  variant,
  month,
  today,
  data,
  taskHrefs,
  basePath,
  noDueHref,
}: SpaceCalendarProps) {
  const router = useRouter();
  const [upcomingExpanded, setUpcomingExpanded] = useState(false);

  /** 月网格按 dueDate 索引（`data.items` 已覆 42 天窗口）。 */
  const itemsByDate = useMemo(() => {
    const byDate = new Map<string, CalendarTaskItem[]>();

    for (const item of data.items) {
      const bucket = byDate.get(item.dueDate);

      if (bucket) {
        bucket.push(item);
      } else {
        byDate.set(item.dueDate, [item]);
      }
    }

    return byDate;
  }, [data.items]);

  /** 侧栏本周窗口（与 service 同口径：周一起 7 天）。 */
  const weekStart = getWeekStart(today);
  const weekEnd = addDays(weekStart, 6);

  /** 本周任务按日分组；今天组置顶，其余按日期升序。 */
  const weekGroups = useMemo(() => {
    const byDate = new Map<string, CalendarTaskItem[]>();

    for (const item of data.weekItems) {
      const bucket = byDate.get(item.dueDate);

      if (bucket) {
        bucket.push(item);
      } else {
        byDate.set(item.dueDate, [item]);
      }
    }

    const dates = [...byDate.keys()].sort((left, right) => {
      if (left === today) return -1;
      if (right === today) return 1;

      return left < right ? -1 : left > right ? 1 : 0;
    });

    return dates.map((date) => ({ date, items: byDate.get(date)! }));
  }, [data.weekItems, today]);

  /** 当前月显示「今天」选中态，翻到其他月时选中月初（仅视觉锚点）。 */
  const calendarValue: Dayjs =
    month === today.slice(0, 7) ? dayjs(today) : dayjs(`${month}-01`);

  const upcomingVisible = upcomingExpanded
    ? data.monthUpcoming
    : data.monthUpcoming.slice(0, UPCOMING_PREVIEW);
  const upcomingRest = data.monthUpcoming.length - UPCOMING_PREVIEW;

  /** 翻月：沿用 basePath，只替换 `?month=`。 */
  function pushMonth(target: Dayjs) {
    router.push(`${basePath}?month=${target.format("YYYY-MM")}`);
  }

  const navButtonClassName =
    "rounded-md border border-[#e1e3e6] bg-white px-2.5 py-[3px] text-[13px] text-[#3c4043] hover:border-[#c7cdd3] hover:text-[#0e1318]";

  return (
    <div>
      {/* ===== 顶部说明行（原型 filterbar） ===== */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        {variant === "personal" ? (
          data.noDueCount > 0 ? (
            <span className="text-[12px] text-[#9aa0a6]">
              {noDueHref ? (
                <Link
                  href={noDueHref}
                  className="font-medium text-[#7d2ae8] hover:underline"
                >
                  {data.noDueCount} 项任务没有截止日期 →
                </Link>
              ) : (
                <span className="font-medium text-[#7d2ae8]">
                  {data.noDueCount} 项任务没有截止日期 →
                </span>
              )}
              (在 Dashboard 查看)
            </span>
          ) : null
        ) : (
          <span className="flex flex-wrap items-center gap-1.5 text-[12px] text-[#5f6368]">
            <span className="inline-flex items-center gap-1 rounded-full bg-[rgba(13,153,255,0.1)] px-2 py-0.5 text-[11px] font-medium text-[#0d99ff]">
              <span className="h-1.5 w-1.5 rounded-full bg-current" />
              未指派
            </span>
            任务也会按截止日期出现在日历上
          </span>
        )}

        <span className="flex-1" />
        <span className="text-[12px] text-[#9aa0a6]">
          基准日期 {today}（{weekdayLabel(today)}）
        </span>
      </div>

      <div className="flex flex-col items-stretch gap-4 min-[861px]:flex-row min-[861px]:items-start">
        {/* ===== 左：月历 ===== */}
        <div className="min-w-0 flex-1">
          <div className="rounded-xl border border-[#e1e3e6] bg-white p-3">
            <Calendar
              fullscreen
              value={calendarValue}
              styles={{ itemContent: { height: 100 } }}
              headerRender={({ value }) => (
                <div className="mb-3 flex items-center gap-2">
                  <span className="min-w-[110px] text-[16px] font-bold text-[#0e1318]">
                    {value.year()} 年 {value.month() + 1} 月
                  </span>
                  <button
                    type="button"
                    aria-label="上个月"
                    className={navButtonClassName}
                    onClick={() => {
                      pushMonth(value.subtract(1, "month"));
                    }}
                  >
                    ‹
                  </button>
                  <button
                    type="button"
                    aria-label="下个月"
                    className={navButtonClassName}
                    onClick={() => {
                      pushMonth(value.add(1, "month"));
                    }}
                  >
                    ›
                  </button>
                  <button
                    type="button"
                    aria-label="今天"
                    className={`${navButtonClassName} border-[#7d2ae8] text-[#7d2ae8] hover:border-[#7d2ae8] hover:text-[#7d2ae8]`}
                    onClick={() => {
                      router.push(basePath);
                    }}
                  >
                    今天
                  </button>
                </div>
              )}
              cellRender={(date, info) => {
                if (info.type !== "date") return info.originNode;

                const dateKey = date.format("YYYY-MM-DD");
                const dayItems = itemsByDate.get(dateKey);

                if (!dayItems || dayItems.length === 0) return null;

                return (
                  <DayCell
                    variant={variant}
                    items={dayItems}
                    today={today}
                    taskHrefs={taskHrefs}
                    dimmed={date.format("YYYY-MM") !== month}
                  />
                );
              }}
            />
          </div>
        </div>

        {/* ===== 右：侧栏 ===== */}
        <aside className="flex w-full flex-col gap-3 min-[861px]:w-[320px] min-[861px]:flex-none">
          {/* 本周任务 */}
          <section className="rounded-xl border border-[#e1e3e6] bg-white p-3">
            <h3 className="text-[13px] font-bold text-[#0e1318]">本周任务</h3>
            <div className="mb-2 text-[11.5px] text-[#9aa0a6]">
              {shortDate(weekStart)} 周一 ~ {shortDate(weekEnd)} 周日 ·{" "}
              {data.weekItems.length} 项
            </div>

            {weekGroups.length === 0 ? (
              <p className="py-2 text-[12px] text-[#9aa0a6]">
                本周没有要截止的任务
              </p>
            ) : (
              weekGroups.map((group) => {
                const isToday = group.date === today;

                return (
                  <div
                    key={group.date}
                    className="border-t border-dashed border-[#e1e3e6] py-[7px]"
                  >
                    <div className="mb-1 flex items-center gap-1.5 text-[11.5px] text-[#9aa0a6]">
                      {isToday ? (
                        <>
                          <b className="font-semibold text-[#7d2ae8]">
                            今天 · {weekdayLabel(today)} {shortDate(today)}
                          </b>
                          <span className="rounded-full bg-[rgba(155,135,245,0.14)] px-1.5 py-px text-[10px] text-[#7d2ae8]">
                            {group.items.length} 项
                          </span>
                        </>
                      ) : (
                        <span>
                          {weekdayLabel(group.date)} {shortDate(group.date)}
                        </span>
                      )}
                    </div>

                    {group.items.map((item) => (
                      <WeekItem
                        key={item.id}
                        variant={variant}
                        item={item}
                        today={today}
                        href={taskHrefs[item.id]}
                      />
                    ))}
                  </div>
                );
              })
            )}
          </section>

          {/* 本月即将到期 */}
          <section className="rounded-xl border border-[#e1e3e6] bg-white p-3">
            <h3 className="text-[13px] font-bold text-[#0e1318]">
              本月即将到期
            </h3>
            <div className="mb-2 text-[11.5px] text-[#9aa0a6]">
              本周之后 · 本月以内
            </div>

            {data.monthUpcoming.length === 0 ? (
              <p className="py-2 text-[12px] text-[#9aa0a6]">
                本月暂无即将到期的任务
              </p>
            ) : (
              <>
                {upcomingVisible.map((item) => (
                  <UpcomingItem
                    key={item.id}
                    variant={variant}
                    item={item}
                    today={today}
                    href={taskHrefs[item.id]}
                  />
                ))}

                {upcomingRest > 0 ? (
                  <div className="mt-2 border-t border-dashed border-[#e1e3e6] pt-2 text-[12px]">
                    <button
                      type="button"
                      className="font-medium text-[#7d2ae8] hover:underline"
                      onClick={() => {
                        setUpcomingExpanded((current) => !current);
                      }}
                    >
                      {upcomingExpanded
                        ? "收起"
                        : `查看本月其余 ${upcomingRest} 项 →`}
                    </button>
                  </div>
                ) : null}
              </>
            )}
          </section>
        </aside>
      </div>
    </div>
  );
}
