"use client";

import { addDays } from "@open-doing/types";
import { enUS, zhCN } from "date-fns/locale";
import { useLocale, useTranslations } from "next-intl";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";
import { DayPicker, type DayProps } from "react-day-picker";

import { HintBadge } from "@/components/ui/HintBadge";
import { NewTaskModal } from "@/features/personal/tasks/components/NewTaskModal";
import { NewTeamTaskModal } from "@/features/tasks/components/NewTeamTaskModal";
import {
  WEEKDAY_KEYS,
  daysBetween,
  getWeekStart,
  weekdayIndex,
} from "@/lib/today";
import { formatTaskDate } from "@/lib/date-display";

import {
  dateKey,
  indexTasksByDate,
  monthAnchor,
  shiftMonth,
} from "./calendar-grid";
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
  /**
   * 格子「+」新建任务入口（可选；缺省则日历保持只读）。
   * 项目 / 成员选项由页面（服务端）取好传入，本组件只负责弹窗接线。
   */
  createTask?: SpaceCalendarCreateTask;
}

/** 格子「+」新建任务入口所需的选项数据。 */
export interface SpaceCalendarCreateTask {
  /** 个人 / 团队项目选项（新建弹窗项目下拉）。 */
  projects: { id: string; name: string }[];
  /** 团队空间专用：团队 ID（variant=team 时必填）。 */
  teamId?: string;
  /** 团队空间专用：可指派成员。 */
  members?: { id: string; name: string }[];
  /** 团队空间专用：默认责任人（通常为当前用户）。 */
  defaultAssigneeId?: string | null;
}

/** 「本月即将到期」默认展示条数（其余折叠）。 */
const UPCOMING_PREVIEW = 5;

/** 单格最多展示的 chip 数，溢出显示「还有 K 项」。 */
const CELL_CHIP_LIMIT = 3;

/** 固定格高（px）：内容只截断不撑格，整月行高恒定。 */
const CELL_HEIGHT = 138;

/** 负责人头像定色盘（含原型示例色：林紫 / 何蓝 / 苏粉）。 */
const ASSIGNEE_COLORS = [
  "#7d2ae8",
  "#0088ff",
  "#e91e63",
  "#00b894",
  "#ff9633",
  "#9b87f5",
] as const;

/** 到期紧迫度：决定 chip 色条 / 底色 / meta 配色。 */
type Tone = "done" | "overdue" | "today" | "soon" | "later";

/**
 * chip 视觉（对照 space-calendar-v2.html）：低饱和底 + 左侧 3px 色条，
 * 文字随色调；中性档保持墨色，逾期红字报警，done 退化为纯文本。
 */
const CHIP_TONE_CLASS: Record<Tone, string> = {
  done: "",
  overdue: "bg-[var(--error-bg)] text-[var(--error-500)]",
  today: "bg-[var(--warning-bg)] text-[#8a5800]",
  soon: "bg-[var(--accent-tangerine-bg)] text-[#b35400]",
  later: "bg-[var(--surface-inset)] text-[var(--ink-700)]",
};

/** chip 左色条颜色（紧迫度承载层）。 */
const CHIP_BAR_CLASS: Record<Tone, string> = {
  done: "",
  overdue: "bg-[var(--error-500)]",
  today: "bg-[var(--warning-500)]",
  soon: "bg-[var(--accent-tangerine)]",
  later: "bg-[var(--ink-400)]",
};

/** 负责人 id 哈希：同一负责人跨渲染恒定映射到同一头像底色。 */
function hashAssigneeId(assigneeId: string): number {
  let hash = 0;

  for (const char of assigneeId) {
    hash = (hash * 31 + (char.codePointAt(0) ?? 0)) >>> 0;
  }

  return hash;
}

/** 负责人头像底色（定色盘，非 antd 头像）。 */
function assigneeColor(assigneeId: string): string {
  return ASSIGNEE_COLORS[hashAssigneeId(assigneeId) % ASSIGNEE_COLORS.length]!;
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

/**
 * 本周清单条目的右侧 meta（逐 variant 对齐原型）：
 * - 个人：done「已完成」/ 逾期 / 今天显示项目名 / 未来倒计时；
 * - 团队：done「已完成」/ 逾期 / 未来倒计时（今天无 meta）。
 */
/** 本周清单右侧 meta 描述符：文案 key 由 `WeekItem` 渲染期翻译。 */
type WeekMeta =
  | { kind: "done" }
  | { kind: "overdue"; days: number }
  | { kind: "project"; text: string }
  | { kind: "daysLeft"; days: number };

function weekMeta(
  item: CalendarTaskItem,
  today: string,
  variant: "personal" | "team",
): WeekMeta | null {
  if (item.done) return { kind: "done" };

  const diff = daysBetween(today, item.dueDate);

  if (diff < 0) return { kind: "overdue", days: -diff };

  if (diff === 0) {
    // 原型：个人版今天组显示项目名作为 meta；团队版无 meta。
    if (variant === "personal" && item.projectName) {
      return { kind: "project", text: item.projectName };
    }

    return null;
  }

  return { kind: "daysLeft", days: diff };
}

/** 团队负责人头像：首字 + 按 assigneeId 哈希的定色盘底色（chip 14px / 侧栏 16px）。 */
function AssigneeBadge({
  seed,
  name,
  size,
}: {
  seed: string;
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
        backgroundColor: assigneeColor(seed),
      }}
    >
      {firstChar}
    </span>
  );
}

/** 未指派 grid chip 描边 tag（颜色继承 chip 文字色，对照 `.tag-un`）。 */
function ChipUnassignedTag() {
  const tTasks = useTranslations("tasks");

  return (
    <span className="ml-[4px] shrink-0 whitespace-nowrap rounded-full border border-current px-1 text-[9.5px] leading-[1.5]">
      {tTasks("unassigned")}
    </span>
  );
}

/** 侧栏未指派 tag：蓝底信息色 + 前置圆点（对照 `.tag.tag-info`）。 */
function SidebarUnassignedTag() {
  const tTasks = useTranslations("tasks");

  return (
    <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-[var(--info-bg)] px-1.5 py-px text-[9.5px] font-medium text-[var(--info-500)]">
      <span className="h-1.5 w-1.5 rounded-full bg-current" />
      {tTasks("unassigned")}
    </span>
  );
}

/** 侧栏负责人前缀：有负责人用头像，未指派用蓝色信息 tag。 */
function SidebarAssignee({ item }: { item: CalendarTaskItem }) {
  if (!item.assigneeName) return <SidebarUnassignedTag />;

  return (
    <AssigneeBadge
      seed={item.assigneeId ?? item.assigneeName}
      name={item.assigneeName}
      size={16}
    />
  );
}

/** chip / 纯文本 done 条目的标题载体（href 有无决定 Link 或 span）。 */
function TaskTitle({
  item,
  href,
  className,
}: {
  item: CalendarTaskItem;
  href?: string;
  className: string;
}) {
  if (href) {
    return (
      <Link href={href} className={`${className} hover:underline`}>
        {item.title}
      </Link>
    );
  }

  return <span className={className}>{item.title}</span>;
}

/**
 * 月网格单条任务 chip：胶囊形、左侧 3px 紧迫度色条、低饱和底，
 * 团队负责人前缀头像；done 无底色纯文本划线（对照 space-calendar-v2.html）。
 */
function CalendarChip({
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

  // done：无底色纯文本，淡显 + 划线（视觉重量低于一枚 chip）。
  if (tone === "done") {
    return (
      <span className="ml-[9px] mt-[5px] block w-fit max-w-full text-[11.5px] leading-[1.4] text-[var(--ink-400)]">
        <TaskTitle
          item={item}
          href={href}
          className="block max-w-full truncate line-through"
        />
      </span>
    );
  }

  return (
    <div
      className={`mt-[5px] flex w-fit max-w-full items-stretch overflow-hidden rounded-full text-[11.5px] leading-[1.4] ${CHIP_TONE_CLASS[tone]}`}
    >
      <span className={`w-[3px] shrink-0 ${CHIP_BAR_CLASS[tone]}`} />

      {variant === "team" ? (
        item.assigneeName ? (
          <AssigneeBadge
            seed={item.assigneeId ?? item.assigneeName}
            name={item.assigneeName}
            size={14}
          />
        ) : (
          <ChipUnassignedTag />
        )
      ) : null}

      <TaskTitle
        item={item}
        href={href}
        className="min-w-0 truncate py-[2.5px] pl-[6px] pr-[9px]"
      />
    </div>
  );
}

/**
 * 月网格整格（对照 space-calendar-v2.html）：
 *
 * - 固定 138px 高 + overflow-hidden：内容只截断不撑格，整月行高恒定；
 * - 无边框画布：hover 才浮现 12px 圆角底色，结构在交互中显形；
 * - 今天 = 全页唯一重音：品牌渐变日期盘 + 淡紫底 + 1.5px 紫描边环；
 * - 右上角 hover 浮现「+」，点击按该日期预填新建任务弹窗（今天格不显示）；
 * - 由 react-day-picker 的自定义 `Day` 渲染进 `<td title="YYYY-MM-DD">`
 *   （e2e 07 以 `td[title]` 定位日期格）。
 */
function CalendarDayCell({
  variant,
  cellDateKey,
  items,
  today,
  month,
  taskHrefs,
  onAddTask,
}: {
  variant: "personal" | "team";
  cellDateKey: string;
  items: CalendarTaskItem[];
  today: string;
  month: string;
  taskHrefs: Record<string, string>;
  onAddTask?: (dateKey: string) => void;
}) {
  const tDate = useTranslations("date");
  const tCalendar = useTranslations("calendar");
  const isToday = cellDateKey === today;
  const isOut = cellDateKey.slice(0, 7) !== month;
  const visible = items.slice(0, CELL_CHIP_LIMIT);
  const overflow = items.length - visible.length;

  return (
    <div
      className={`group relative m-[3px] flex flex-col overflow-hidden rounded-xl px-2 pb-2 pt-[7px] transition-colors duration-150 ${
        isToday
          ? "bg-[var(--purple-08)] shadow-[inset_0_0_0_1.5px_var(--purple-30)] hover:bg-[var(--purple-14)]"
          : "hover:bg-[var(--surface-subtle)]"
      }`}
      style={{ height: CELL_HEIGHT - 6 }}
    >
      {/* hover / 键盘聚焦浮现的快捷「+」（今天格保持唯一重音，不显示） */}
      {onAddTask && !isToday ? (
        <button
          type="button"
          aria-label={tCalendar("addTaskAria", { date: cellDateKey })}
          title={tCalendar("addTaskAria", { date: cellDateKey })}
          className="absolute right-2 top-1.5 opacity-0 transition-opacity duration-150 focus-visible:opacity-100 group-hover:opacity-100"
          onClick={() => {
            onAddTask(cellDateKey);
          }}
        >
          <PlusIcon />
        </button>
      ) : null}

      <div className="flex items-center px-1">
        <span
          className={`inline-flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-full tabular-nums ${
            isToday
              ? "bg-[image:var(--brand-gradient)] text-[13.5px] font-bold text-white"
              : isOut
                ? "text-[color-mix(in_srgb,var(--ink-400)_50%,transparent)]"
                : "text-[15px] text-[var(--ink-900)]"
          }`}
        >
          {Number(cellDateKey.slice(8))}
        </span>
        {isToday ? (
          <span className="sr-only">{tDate("today")}</span>
        ) : null}
      </div>

      <div
        className={`flex flex-col items-start ${isOut ? "opacity-50" : ""}`}
      >
        {visible.map((item) => (
          <CalendarChip
            key={item.id}
            variant={variant}
            item={item}
            today={today}
            href={taskHrefs[item.id]}
          />
        ))}

        {overflow > 0 ? (
          <span className="ml-[9px] mt-[5px] text-[11px] font-medium text-[color-mix(in_srgb,var(--primary)_78%,transparent)]">
            {tCalendar("cellOverflow", { count: overflow })}
          </span>
        ) : null}
      </div>
    </div>
  );
}

/** 「+」图标（新建任务快捷入口）。 */
function PlusIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 14 14"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <path d="M7 2.5v9M2.5 7h9" />
    </svg>
  );
}

/** 本周清单单条：标题 + 右侧 meta（时间线节点由日分组渲染）。 */
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
  const tCalendar = useTranslations("calendar");
  const tStatus = useTranslations("status");
  const meta = weekMeta(item, today, variant);
  const titleClassName = `min-w-0 flex-1 truncate ${
    item.done ? "line-through" : ""
  }`;
  // meta 配色按语义：逾期红字报警、3 天内倒计时琥珀、其余淡墨。
  const metaClassName =
    meta?.kind === "overdue"
      ? "text-[var(--error-500)] font-medium"
      : meta?.kind === "daysLeft" && meta.days <= 3
        ? "text-[#b35400]"
        : "text-[var(--ink-400)]";

  return (
    <div
      className={`-mx-2 flex items-center gap-1.5 rounded-md px-2 py-1 text-[12.5px] transition-colors duration-150 hover:bg-[var(--surface-subtle)] ${
        item.done ? "text-[var(--ink-400)]" : "text-[var(--ink-900)]"
      }`}
    >
      {variant === "team" ? <SidebarAssignee item={item} /> : null}

      <TaskTitle item={item} href={href} className={titleClassName} />

      {meta ? (
        <span
          className={`ml-auto shrink-0 whitespace-nowrap text-[11px] ${metaClassName}`}
        >
          {meta.kind === "done"
            ? tStatus("completed")
            : meta.kind === "overdue"
              ? tCalendar("metaOverdue", { days: meta.days })
              : meta.kind === "daysLeft"
                ? tCalendar("metaDaysLeft", { days: meta.days })
                : meta.text}
        </span>
      ) : null}
    </div>
  );
}

/** 「本月即将到期」单条：迷你日期块（大数字 + 月份角标）+ 标题 + 倒计时。 */
function UpcomingItem({
  variant,
  item,
  today,
  locale,
  href,
}: {
  variant: "personal" | "team";
  item: CalendarTaskItem;
  today: string;
  locale: string;
  href?: string;
}) {
  const tCalendar = useTranslations("calendar");
  const monthTag = useMemo(() => {
    // 数字入参构造本地 Date（不走 `new Date("YYYY-MM-DD")` 的 UTC 解析），
    // 再按请求 locale 输出短月份（zh「10月」/ en「Oct」）。
    const date = new Date(
      Number(item.dueDate.slice(0, 4)),
      Number(item.dueDate.slice(5, 7)) - 1,
      Number(item.dueDate.slice(8, 10)),
    );

    return new Intl.DateTimeFormat(locale === "zh" ? "zh-CN" : "en-US", {
      month: "short",
    }).format(date);
  }, [item.dueDate, locale]);

  return (
    <div className="flex items-center gap-2.5 py-[5px]">
      <span className="flex h-[36px] w-[34px] shrink-0 flex-col items-center justify-center rounded-lg border border-[var(--border-default)] bg-[var(--surface-subtle)] leading-none">
        <span className="text-[14px] font-semibold tabular-nums text-[var(--ink-700)]">
          {Number(item.dueDate.slice(8, 10))}
        </span>
        <span className="mt-px text-[9px] text-[var(--ink-400)]">
          {monthTag}
        </span>
      </span>

      {variant === "team" ? <SidebarAssignee item={item} /> : null}

      <TaskTitle
        item={item}
        href={href}
        className="min-w-0 flex-1 truncate text-[12.5px] text-[var(--ink-900)]"
      />

      <span className="ml-auto shrink-0 whitespace-nowrap text-[11px] text-[var(--ink-400)]">
        {tCalendar("metaDaysLeft", {
          days: daysBetween(today, item.dueDate),
        })}
      </span>
    </div>
  );
}

/**
 * 空间级 Calendar v2（个人 / 团队共用，对照 `space-calendar-v2.html`）。
 *
 * 视觉：无边框画布（去竖向格线、hover 浮现格底）、渐变今天盘 + 描边环、
 * 胶囊 chip（左色条 + 低饱和底）、固定格高内容截断；侧栏改为竖向时间线
 * （本周）+ 迷你日期块（即将到期）。
 *
 * 结构契约（保持 e2e 兼容）：
 * - react-day-picker（DayPicker）受控于 URL 月份，自定义 `Day` 渲染
 *   `<td title>`（e2e 07 以 `td[title]` 定位 42 格）；
 * - 标题行（‹ › / 今天）在网格卡片之外自绘并 `router.push` 翻月，
 *   testid `calendar-prev-month` / `calendar-next-month` / `calendar-today`；
 * - 侧栏本周卡片 testid `calendar-week-card`；网格横滚与右缘滚动暗示
 *   testid `calendar-grid-scroll` / `calendar-scroll-shadow`；
 * - 锚点与键全部走本地日历字段（calendar-grid），不经
 *   `new Date("YYYY-MM-DD")` 的 UTC 解析。
 */
export function SpaceCalendar({
  variant,
  month,
  today,
  data,
  taskHrefs,
  basePath,
  noDueHref,
  createTask,
}: SpaceCalendarProps) {
  const router = useRouter();
  const locale = useLocale();
  const tDate = useTranslations("date");
  const tCalendar = useTranslations("calendar");
  const [upcomingExpanded, setUpcomingExpanded] = useState(false);
  /** 「+」所点的日期；非 null 时渲染预填该日期的新建任务弹窗。 */
  const [createDate, setCreateDate] = useState<string | null>(null);
  // 翻月 / 回今天都是 RSC 重取数，用 transition 标记 pending：旧月保持
  // 可见，导航按钮降透明度作为「正在加载」的反馈。
  const [monthPending, startMonthTransition] = useTransition();

  /**
   * 月网格横向滚动：窄视口下 42 格（7 列 × 6 行）无法被压到容器宽度内，
   * 卡片内改为横向滚动；仅当还能继续向右滚动时，右缘叠加渐变阴影作为
   * 「还有列未露出」的滚动暗示（滚到最右即隐藏）。
   */
  const gridScrollRef = useRef<HTMLDivElement>(null);
  const gridContentRef = useRef<HTMLDivElement>(null);
  const [showGridRightShadow, setShowGridRightShadow] = useState(false);

  const updateGridScrollShadow = useCallback(() => {
    const element = gridScrollRef.current;

    if (!element) return;

    setShowGridRightShadow(
      element.scrollLeft + element.clientWidth < element.scrollWidth - 1,
    );
  }, []);

  useEffect(() => {
    const element = gridScrollRef.current;

    if (!element) return;

    updateGridScrollShadow();
    // 容器 / 内容尺寸变化（字体加载、窗口缩放、翻月后内容重排）都要重新判定。
    const observer = new ResizeObserver(updateGridScrollShadow);

    observer.observe(element);
    if (gridContentRef.current) observer.observe(gridContentRef.current);

    return () => observer.disconnect();
  }, [updateGridScrollShadow]);

  /** 月网格按 dueDate 索引（`data.items` 已覆 42 天窗口）。 */
  const itemsByDate = useMemo(() => indexTasksByDate(data.items), [data.items]);

  /** 所显示月份的未完成任务数（标题行「N 项截止」元信息）。 */
  const monthDueCount = useMemo(
    () =>
      data.items.filter(
        (item) => !item.done && item.dueDate.startsWith(`${month}-`),
      ).length,
    [data.items, month],
  );

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

  /** 星期表头文案（zh「周一 … 周日」，en 对齐 antd 的 Sun/Mon/…）。 */
  const weekdayLabels = useMemo(
    () =>
      Object.fromEntries(
        WEEKDAY_KEYS.map((key, index) => [index, tDate(key)]),
      ) as Record<number, string>,
    [tDate],
  );

  /** react-day-picker 自定义组件：随数据/月份重建（键与文案闭包）。 */
  const dayPickerComponents = useMemo(
    () => ({
      MonthCaption: () => <></>,
      Day: ({ day, ...tdProps }: DayProps) => {
        const key = dateKey(day.date);

        return (
          <td
            {...tdProps}
            title={key}
            className={`${tdProps.className ?? ""} p-0 align-top`}
          >
            <CalendarDayCell
              variant={variant}
              cellDateKey={key}
              items={itemsByDate.get(key) ?? []}
              today={today}
              month={month}
              taskHrefs={taskHrefs}
              onAddTask={createTask ? setCreateDate : undefined}
            />
          </td>
        );
      },
    }),
    [variant, itemsByDate, today, month, taskHrefs, createTask],
  );

  const upcomingVisible = upcomingExpanded
    ? data.monthUpcoming
    : data.monthUpcoming.slice(0, UPCOMING_PREVIEW);
  const upcomingRest = data.monthUpcoming.length - UPCOMING_PREVIEW;

  /** 翻月：沿用 basePath，只替换 `?month=`（transition 包裹，pending 反馈）。 */
  function pushMonth(monthKey: string) {
    startMonthTransition(() => router.push(`${basePath}?month=${monthKey}`));
  }

  const navButtonClassName = `inline-flex h-8 w-8 items-center justify-center rounded-lg text-[16px] text-[var(--ink-700)] transition-[color,background-color,opacity] duration-150 hover:bg-[var(--surface-subtle)] hover:text-[var(--ink-900)] ${
    monthPending ? "opacity-50" : ""
  }`;

  return (
    <div>
      {/* ===== 顶部说明行（原型 filterbar） ===== */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        {variant === "personal" ? (
          data.noDueCount > 0 ? (
            <span className="text-[12px] text-[var(--ink-400)]">
              {noDueHref ? (
                <Link
                  href={noDueHref}
                  className="font-medium text-[var(--purple-600)] hover:underline"
                >
                  {tCalendar("noDueLink", { count: data.noDueCount })}
                </Link>
              ) : (
                <span className="font-medium text-[var(--purple-600)]">
                  {tCalendar("noDueLink", { count: data.noDueCount })}
                </span>
              )}
              {tCalendar("viewInDashboard")}
            </span>
          ) : null
        ) : (
          // 未指派任务上日历的说明收敛为 ⓘ 徽章，触发器保留短摘要。
          <HintBadge
            ariaLabel={tCalendar("teamHintAria")}
            summary={tCalendar("teamHintSummary")}
            title={tCalendar("teamHintTitle")}
            items={[tCalendar("teamHint"), tCalendar("teamHintClick")]}
          />
        )}

        <span className="flex-1" />
        <HintBadge
          ariaLabel={tDate("todayHintAria")}
          summary={tDate("todayCaption", {
            date: today,
            weekday: tDate(WEEKDAY_KEYS[weekdayIndex(today)]),
          })}
          title={tDate("todayHintTitle")}
          items={[tDate("todayHintItem")]}
        />
      </div>

      {/* 桌面端 items-stretch：侧栏随月历列拉伸到底，底边对齐（见 aside 的 mt 偏移）。 */}
      <div className="flex flex-col items-stretch gap-4 min-[861px]:flex-row min-[861px]:items-stretch">
        {/* ===== 左：月历 ===== */}
        <div className="min-w-0 flex-1">
          {/* 月历标题行：网格卡片之外（原型 .cal2-header）。 */}
          <div className="mb-3 flex items-center gap-2.5">
            <h2 className="text-[22px] font-semibold leading-none tracking-[-0.01em] text-[var(--ink-900)]">
              {tCalendar("monthTitle", {
                year: Number(month.slice(0, 4)),
                month: Number(month.slice(5, 7)),
              })}
            </h2>
            <span className="text-[13px] text-[var(--ink-400)]">
              {tCalendar("monthDueCount", { count: monthDueCount })}
            </span>
            <div className="ml-auto flex items-center gap-0.5">
              <button
                type="button"
                data-testid="calendar-prev-month"
                aria-label={tCalendar("prevMonth")}
                className={navButtonClassName}
                onClick={() => {
                  pushMonth(shiftMonth(month, -1));
                }}
              >
                ‹
              </button>
              <button
                type="button"
                data-testid="calendar-next-month"
                aria-label={tCalendar("nextMonth")}
                className={navButtonClassName}
                onClick={() => {
                  pushMonth(shiftMonth(month, 1));
                }}
              >
                ›
              </button>
              <button
                type="button"
                data-testid="calendar-today"
                aria-label={tDate("today")}
                className={`ml-1.5 inline-flex h-8 items-center rounded-lg px-3 text-[13px] font-medium text-[var(--purple-600)] transition-[color,background-color,opacity] duration-150 hover:bg-[var(--primary-bg)] ${
                  monthPending ? "opacity-50" : ""
                }`}
                onClick={() => {
                  startMonthTransition(() => router.push(basePath));
                }}
              >
                {tDate("today")}
              </button>
            </div>
          </div>

          {/* 卡片只包住星期表头 + 网格本体。 */}
          <div className="overflow-hidden rounded-2xl border border-[var(--border-default)] bg-white shadow-[var(--shadow-rest)]">
            <div className="relative">
              {/* 窄视口下 7 列 × 6 行在卡内横向滚动，最右列始终可到达。 */}
              <div
                ref={gridScrollRef}
                data-testid="calendar-grid-scroll"
                onScroll={updateGridScrollShadow}
                className="overflow-x-auto"
              >
                <div ref={gridContentRef} className="min-w-[560px]">
                  <DayPicker
                    month={monthAnchor(month)}
                    onMonthChange={(date) => {
                      router.push(`${basePath}?month=${dateKey(date).slice(0, 7)}`);
                    }}
                    hideNavigation
                    showOutsideDays
                    fixedWeeks
                    weekStartsOn={1}
                    locale={locale === "zh" ? zhCN : enUS}
                    formatters={{
                      formatWeekdayName: (date) =>
                        weekdayLabels[date.getDay()] ?? "",
                    }}
                    classNames={{
                      months: "w-full",
                      month: "w-full",
                      // table-fixed：列宽均分于容器，无空格长串在 chip 层截断，不再撑爆列宽。
                      month_grid: "w-full table-fixed border-collapse",
                      weekdays: "border-b border-b-[var(--border-default)]",
                      // 表头行高：上 12 / 下 10（对照原型 .cal2-headrow .h）。
                      weekday:
                        "pb-2.5 pt-3 text-center text-[12.5px] font-normal text-[var(--ink-400)]",
                      // 周间横分隔：极淡（55% 描边色），仅扫描用；与表头
                      // border-b 在 border-collapse 下并作一条。
                      week: "border-t border-t-[color-mix(in_srgb,var(--border-default)_55%,transparent)]",
                      day: "p-0 align-top",
                    }}
                    components={dayPickerComponents}
                  />
                </div>
              </div>

              {/* 右缘滚动阴影：颜色由 ink token 经 color-mix 取 alpha，不落字面色值。 */}
              {showGridRightShadow ? (
                <div
                  aria-hidden="true"
                  data-testid="calendar-scroll-shadow"
                  className="pointer-events-none absolute inset-y-0 right-0 w-10"
                  style={{
                    backgroundImage:
                      "linear-gradient(to left, color-mix(in srgb, var(--ink-900) 16%, transparent), transparent)",
                  }}
                />
              ) : null}
            </div>
          </div>
        </div>

        {/* ===== 右：侧栏 ===== */}
        {/* 侧栏顶对齐月历网格（而非标题行）：mt = 月标题行高（22px leading-none
            + mb-3 12px）。改标题字号/间距时需同步这个偏移。末卡 flex-1 沉底。 */}
        <aside className="flex w-full flex-col gap-3 min-[861px]:mt-[34px] min-[861px]:w-[320px] min-[861px]:flex-none">
          {/* 本周任务：竖向时间线（脊线 + 日节点，今天为紫色发光点）。 */}
          <section
            data-testid="calendar-week-card"
            className="rounded-xl border border-[var(--border-default)] bg-white p-4 shadow-[var(--shadow-rest)]"
          >
            <div className="mb-3 flex items-baseline">
              <h3 className="text-[14px] font-semibold text-[var(--ink-900)]">
                {tCalendar("thisWeek")}
              </h3>
              <span className="ml-auto text-[11px] tabular-nums text-[var(--ink-400)]">
                {tCalendar("weekRange", {
                  start: formatTaskDate(weekStart),
                  end: formatTaskDate(weekEnd),
                  count: data.weekItems.length,
                })}
              </span>
            </div>

            {weekGroups.length === 0 ? (
              <p className="py-2 text-[12px] text-[var(--ink-400)]">
                {tCalendar("weekEmpty")}
              </p>
            ) : (
              <div className="relative pl-[21px]">
                {/* 时间线脊线 */}
                <span
                  aria-hidden="true"
                  className="absolute bottom-3 left-[4px] top-3 w-[2px] rounded bg-[var(--surface-inset)]"
                />

                {weekGroups.map((group) => {
                  const isToday = group.date === today;

                  return (
                    <div key={group.date} className="relative py-[7px]">
                      {/* 日节点：今天紫色实心 + 光环，其余灰描边 */}
                      <span
                        aria-hidden="true"
                        className={`absolute -left-[21px] top-[13px] h-[9px] w-[9px] rounded-full border-2 ${
                          isToday
                            ? "border-[var(--purple-600)] bg-[var(--purple-600)] shadow-[0_0_0_3px_var(--purple-14)]"
                            : "border-[var(--border-strong)] bg-white"
                        }`}
                      />

                      <div className="mb-1 flex items-center gap-1.5 text-[11px] text-[var(--ink-400)]">
                        {isToday ? (
                          <>
                            <b className="font-semibold text-[var(--purple-600)]">
                              {tDate("today")} ·{" "}
                              {tDate(WEEKDAY_KEYS[weekdayIndex(today)])}{" "}
                              {formatTaskDate(today)}
                            </b>
                            <span className="rounded-full bg-[var(--accent-lavender-bg)] px-1.5 py-px text-[10px] font-medium text-[var(--purple-600)]">
                              {tCalendar("countItems", {
                                count: group.items.length,
                              })}
                            </span>
                          </>
                        ) : (
                          <span className="tabular-nums">
                            {tDate(WEEKDAY_KEYS[weekdayIndex(group.date)])}{" "}
                            {formatTaskDate(group.date)}
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
                })}
              </div>
            )}
          </section>

          {/* 本月即将到期：迷你日期块列表；桌面端 flex-1 填满侧栏剩余高度，与月历底边对齐。 */}
          <section className="min-[861px]:flex-1 rounded-xl border border-[var(--border-default)] bg-white p-4 shadow-[var(--shadow-rest)]">
            <div className="mb-2 flex items-baseline">
              <h3 className="text-[14px] font-semibold text-[var(--ink-900)]">
                {tCalendar("upcomingTitle")}
              </h3>
              <span className="ml-auto text-[11px] text-[var(--ink-400)]">
                {tCalendar("upcomingHint")}
              </span>
            </div>

            {data.monthUpcoming.length === 0 ? (
              <p className="py-2 text-[12px] text-[var(--ink-400)]">
                {tCalendar("upcomingEmpty")}
              </p>
            ) : (
              <>
                {upcomingVisible.map((item) => (
                  <UpcomingItem
                    key={item.id}
                    variant={variant}
                    item={item}
                    today={today}
                    locale={locale}
                    href={taskHrefs[item.id]}
                  />
                ))}

                {upcomingRest > 0 ? (
                  <div className="mt-2 border-t border-[var(--border-default)] pt-2 text-[12px]">
                    <button
                      type="button"
                      className="font-medium text-[var(--purple-600)] hover:underline"
                      onClick={() => {
                        setUpcomingExpanded((current) => !current);
                      }}
                    >
                      {upcomingExpanded
                        ? tCalendar("collapse")
                        : tCalendar("upcomingMore", { count: upcomingRest })}
                    </button>
                  </div>
                ) : null}
              </>
            )}
          </section>
        </aside>
      </div>

      {/* 格子「+」触发的新建任务弹窗（按所点日期预填截止日）。 */}
      {createTask ? (
        variant === "personal" ? (
          <NewTaskModal
            open={createDate !== null}
            projects={createTask.projects}
            defaultDueDate={createDate}
            onSuccess={() => {
              setCreateDate(null);
              router.refresh();
            }}
            onCancel={() => {
              setCreateDate(null);
            }}
          />
        ) : (
          <NewTeamTaskModal
            open={createDate !== null}
            teamId={createTask.teamId ?? ""}
            projects={createTask.projects}
            members={createTask.members ?? []}
            defaultAssigneeId={createTask.defaultAssigneeId ?? null}
            defaultDueDate={createDate}
            onSuccess={() => {
              setCreateDate(null);
              router.refresh();
            }}
            onCancel={() => {
              setCreateDate(null);
            }}
          />
        )
      ) : null}
    </div>
  );
}
