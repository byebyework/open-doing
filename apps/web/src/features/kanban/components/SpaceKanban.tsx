"use client";

import type { TaskStatus } from "@open-doing/types";
import { addDays } from "@open-doing/types";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCorners,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import { Button, Tag, message } from "antd";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { UserAvatar } from "@/components/ui/UserAvatar";
import { updatePersonalTaskAction } from "@/features/personal/tasks/actions";
import { canEditTask } from "@/features/tasks/permissions";
import { updateTeamTaskAction } from "@/features/tasks/actions";
import type { TeamRole } from "@/features/teams/permissions";
import { getWeekStart } from "@/lib/today";

import { getOlderDoneTasksAction } from "../actions";
import type {
  KanbanCardItem,
  SpaceBoard,
  TeamKanbanCardItem,
  TeamSpaceBoard,
} from "../service";
import { useIsDesktop } from "./useIsDesktop";

/** 空间看板入参（个人 / 团队共用，团队专有字段可选）。 */
export interface SpaceKanbanProps {
  variant: "personal" | "team";
  /** 已按 URL 筛选过滤后的看板数据。
   *
   * `doneTotal`/`doneOlderCount` 必须是 URL 筛选后的值（post-filter）；页面/RSC
   * 负责按筛选重算，组件不自行过滤。
   */
  board: SpaceBoard | TeamSpaceBoard;
  projects: { id: string; name: string; slug: string }[];
  /** 今天（Asia/Shanghai，`YYYY-MM-DD`）。 */
  today: string;
  // 团队专有
  teamId?: string;
  teamSlug?: string;
  role?: TeamRole;
  actorId?: string;
  /** taskId → 详情页 href（RSC 用 routes builder 生成，可能缺少部分卡片）。 */
  taskHrefs: Record<string, string>;
  /** 当前 URL 筛选（project slug / 仅未指派），原样带给展开「更早」的 Server Action。 */
  expandFilter?: { projectSlug?: string; unassignedOnly?: boolean };
}

/** 看板列顺序。 */
const STATUS_ORDER: readonly TaskStatus[] = ["todo", "in_progress", "done"];

/** 列头文案（对照原型：待办 / 进行中 / 已完成）。 */
const STATUS_LABEL: Record<TaskStatus, string> = {
  todo: "待办",
  in_progress: "进行中",
  done: "已完成",
};

/**
 * 组件内部卡片模型：个人卡没有指派人字段，团队卡在基类上补充
 * `assigneeId` / `assigneeName`（可选，运行时由 variant 决定是否存在）。
 */
type BoardCard = KanbanCardItem & {
  assigneeId?: string | null;
  assigneeName?: string | null;
};

/** 组件内部看板状态：done 拆成近 7 天与「更早」展开部分。 */
interface LocalBoard {
  todo: BoardCard[];
  inProgress: BoardCard[];
  doneRecent: BoardCard[];
  /** 点击「查看更早」后才填充；收起时保留缓存以便再次展开。 */
  doneOlder: BoardCard[];
  doneOlderCount: number;
  doneTotal: number;
}

/** props.board → 本地状态（doneRecent 即 done 列的 7 天视图）。 */
function toLocalBoard(board: SpaceBoard | TeamSpaceBoard): LocalBoard {
  return {
    todo: board.todo,
    inProgress: board.inProgress,
    doneRecent: board.doneRecent,
    doneOlder: [],
    doneOlderCount: board.doneOlderCount,
    doneTotal: board.doneTotal,
  };
}

/** Server Action 失败时取第一条可展示文案。 */
function firstError(errors: Record<string, string>): string {
  return errors.form ?? Object.values(errors)[0] ?? "操作失败，请稍后重试";
}

/** 将 `YYYY-MM-DD` 显示为原型同款 `MM-DD`。 */
function shortDate(date: string): string {
  return /^\d{4}-\d{2}-\d{2}$/.test(date) ? date.slice(5) : date;
}

/** 两个 `YYYY-MM-DD` 之间的整天数（UTC 毫秒算术，不依赖本地时区）。 */
function daysBetween(later: string, earlier: string): number {
  const toUtc = (date: string) => {
    const [year, month, day] = date.split("-").map(Number);
    return Date.UTC(year!, month! - 1, day!);
  };

  return Math.round((toUtc(later) - toUtc(earlier)) / 86_400_000);
}

/** ISO 时间戳 → Asia/Shanghai 日历日的 `MM-DD`（完成日期口径）。 */
function completedShortDate(iso: string): string {
  const calendarDate = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(iso));

  return calendarDate.slice(5);
}

/** 完成时间是否落在本周（含本周一零点，Asia/Shanghai）。 */
function completedThisWeek(completedAt: string, weekStart: string): boolean {
  return (
    new Date(completedAt).getTime() >=
    new Date(`${weekStart}T00:00:00+08:00`).getTime()
  );
}

/** 项目 tag：团队紫 / 个人薄荷；无项目的零散个人任务显示「个人」。 */
function ProjectTag({
  variant,
  projectName,
}: {
  variant: "personal" | "team";
  projectName: string;
}) {
  const isTeam = variant === "team";
  const label = isTeam ? projectName : projectName || "个人";

  return (
    <span
      className="inline-flex max-w-[180px] items-center truncate rounded-full px-2 py-0.5 text-[11px] font-semibold"
      style={
        isTeam
          ? { background: "rgba(155,135,245,0.14)", color: "#6d4fd4" }
          : { background: "rgba(72,201,151,0.12)", color: "#1f9d78" }
      }
    >
      {label}
    </span>
  );
}

/**
 * 卡片底部截止文案（对照原型口径）：
 * 逾期红「MM-DD · 已逾期 N 天」/ 今天「今天到期」/ 明天「明天到期」/
 * 未来灰「MM-DD」/ 无「—」；done 卡显示完成日期「MM-DD 完成」。
 */
function DueLabel({ card, today }: { card: BoardCard; today: string }) {
  if (card.status === "done") {
    return card.completedAt ? (
      <span
        className="whitespace-nowrap text-[12.5px] text-[#9aa0a6]"
        title={card.completedAt}
      >
        {completedShortDate(card.completedAt)} 完成
      </span>
    ) : (
      <span className="text-[12.5px] text-[#9aa0a6]">—</span>
    );
  }

  if (!card.dueDate) {
    return <span className="text-[12.5px] text-[#9aa0a6]">—</span>;
  }

  if (card.dueDate < today) {
    return (
      <span
        className="whitespace-nowrap text-[12.5px] font-semibold text-[#ff5757]"
        title={card.dueDate}
      >
        {shortDate(card.dueDate)} · 已逾期 {daysBetween(today, card.dueDate)} 天
      </span>
    );
  }

  if (card.dueDate === today || card.dueDate === addDays(today, 1)) {
    return (
      <span
        className="whitespace-nowrap text-[12.5px] font-semibold text-[#a66b00]"
        title={card.dueDate}
      >
        {card.dueDate === today ? "今天到期" : "明天到期"}
      </span>
    );
  }

  return (
    <span
      className="whitespace-nowrap text-[12.5px] text-[#5f6368]"
      title={card.dueDate}
    >
      {shortDate(card.dueDate)}
    </span>
  );
}

/** 卡片移动端（<861px）的状态切换按钮：无编辑权时整组禁用。 */
function SpaceStatusButtons({
  variant,
  card,
  teamId,
  editable,
  onChanged,
}: {
  variant: "personal" | "team";
  card: BoardCard;
  teamId?: string;
  editable: boolean;
  onChanged: () => void;
}) {
  const [pending, setPending] = useState<TaskStatus | null>(null);

  async function change(status: TaskStatus) {
    if (pending || status === card.status) return;

    setPending(status);
    try {
      const result =
        variant === "personal"
          ? await updatePersonalTaskAction(card.id, { status })
          : teamId
            ? await updateTeamTaskAction(card.id, { teamId, status })
            : null;

      if (!result) return;

      if (!result.ok) {
        message.error(firstError(result.errors));
        return;
      }

      onChanged();
    } catch {
      message.error("网络异常，请稍后重试");
    } finally {
      setPending(null);
    }
  }

  return (
    <div className="flex flex-wrap gap-1.5">
      {STATUS_ORDER.map((status) => {
        const current = status === card.status;

        return (
          <Button
            key={status}
            size="small"
            type={current ? "primary" : "default"}
            disabled={!editable || current || pending !== null}
            loading={pending === status}
            onClick={() => {
              void change(status);
            }}
          >
            {STATUS_LABEL[status]}
          </Button>
        );
      })}
    </div>
  );
}

/** 单张任务卡片。 */
function SpaceKanbanCard({
  variant,
  card,
  today,
  href,
  draggable,
  editable,
  teamId,
  onChanged,
}: {
  variant: "personal" | "team";
  card: BoardCard;
  today: string;
  href?: string;
  draggable: boolean;
  editable: boolean;
  teamId?: string;
  onChanged: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } =
    useDraggable({ id: card.id, disabled: !draggable });

  const done = card.status === "done";
  const titleClassName = `text-[13.5px] font-semibold leading-[1.35] ${
    done ? "text-[#3c4043]" : "text-[#0e1318]"
  }`;

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform) }}
      className={`rounded-xl border border-[#e1e3e6] bg-white px-3.5 py-3 shadow-[0_1px_3px_rgba(14,19,24,0.04)] transition-shadow hover:shadow-[0_8px_24px_rgba(14,19,24,0.08)] ${
        isDragging ? "opacity-50" : ""
      } ${done ? "opacity-75" : ""}`}
    >
      {/* 拖拽把手覆盖卡片主体；窄屏不挂监听，保住 touch 滚动。 */}
      <div
        {...(draggable ? attributes : {})}
        {...listeners}
        aria-label={card.title}
        className={`select-none min-[861px]:cursor-grab min-[861px]:touch-none ${
          draggable ? "" : "cursor-auto"
        }`}
      >
        <div className="mb-2 flex items-center gap-2">
          <ProjectTag variant={variant} projectName={card.projectName} />
          <span className="flex-1" />
          {card.subtaskTotal > 0 ? (
            <span className="text-[11.5px] tabular-nums text-[#9aa0a6]">
              子任务 {card.subtaskDone}/{card.subtaskTotal}
            </span>
          ) : null}
        </div>

        {href ? (
          <Link
            href={href}
            draggable={false}
            className={`block hover:underline ${titleClassName}`}
          >
            {card.title}
          </Link>
        ) : (
          <span className={`block ${titleClassName}`}>{card.title}</span>
        )}

        <div
          className={`mt-2.5 flex items-center gap-2 ${
            variant === "team" ? "" : "justify-between"
          }`}
        >
          {variant === "team" ? (
            card.assigneeName ? (
              <span className="flex min-w-0 items-center gap-1.5 text-[12.5px] text-[#5f6368]">
                <UserAvatar username={card.assigneeName} size={22} />
                <span className="truncate">{card.assigneeName}</span>
              </span>
            ) : (
              <Tag
                variant="filled"
                style={{
                  marginInlineEnd: 0,
                  border: "none",
                  borderRadius: 9999,
                  paddingInline: 8,
                  color: "#5f6368",
                  background: "#e8eaed",
                  fontSize: 11.5,
                  fontWeight: 500,
                  lineHeight: "20px",
                }}
              >
                未指派
              </Tag>
            )
          ) : null}

          <span className={variant === "team" ? "ml-auto" : undefined}>
            <DueLabel card={card} today={today} />
          </span>
        </div>
      </div>

      <div className="mt-2.5 min-[861px]:hidden">
        <SpaceStatusButtons
          variant={variant}
          card={card}
          teamId={teamId}
          editable={editable}
          onChanged={onChanged}
        />
      </div>
    </div>
  );
}

/** 看板单列（同时是拖放目标）。 */
function SpaceKanbanColumn({
  variant,
  status,
  cards,
  today,
  count,
  overdueCount,
  weekDoneCount,
  doneOlderCount,
  expanded,
  loadingOlder,
  onToggleOlder,
  taskHrefs,
  teamId,
  isDesktop,
  canEditCard,
  onChanged,
}: {
  variant: "personal" | "team";
  status: TaskStatus;
  cards: BoardCard[];
  today: string;
  count: number;
  overdueCount: number;
  weekDoneCount: number;
  doneOlderCount: number;
  expanded: boolean;
  loadingOlder: boolean;
  onToggleOlder: () => void;
  taskHrefs: Record<string, string>;
  teamId?: string;
  isDesktop: boolean;
  canEditCard: (card: BoardCard) => boolean;
  onChanged: () => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: status });

  return (
    <section
      ref={setNodeRef}
      aria-label={STATUS_LABEL[status]}
      className={`min-w-0 rounded-2xl p-3 transition-colors ${
        isOver
          ? "bg-[#eef0fc] outline outline-2 outline-dashed outline-offset-[-4px] outline-[#7d2ae8]"
          : "bg-[#f4f5f7]"
      }`}
    >
      <header className="flex items-center gap-2 px-2 pb-3 pt-1">
        <span className="text-[13.5px] font-bold text-[#0e1318]">
          {STATUS_LABEL[status]}
        </span>
        <span className="rounded-full bg-[#e8eaed] px-2 py-0.5 text-[11px] font-bold text-[#5f6368]">
          {count}
        </span>
        {overdueCount > 0 ? (
          <span
            className="rounded-full px-2 py-0.5 text-[11px] font-bold"
            style={{ color: "#ff5757", background: "rgba(255,87,87,0.1)" }}
          >
            逾期 {overdueCount}
          </span>
        ) : null}
        {status === "done" ? (
          <span
            className="rounded-full px-2 py-0.5 text-[11px] font-bold"
            style={{
              color: "#7d2ae8",
              background: "rgba(155,135,245,0.14)",
            }}
          >
            本周 {weekDoneCount}
          </span>
        ) : null}
        {status === "todo" ? (
          <span className="ml-auto text-[11.5px] text-[#9aa0a6]">
            按截止日期排序
          </span>
        ) : null}
      </header>

      <div className="flex flex-col gap-2">
        {cards.length === 0 ? (
          <p className="rounded-lg border border-dashed border-[#e1e3e6] px-3 py-4 text-center text-[12.5px] text-[#9aa0a6]">
            暂无任务
          </p>
        ) : (
          cards.map((card) => {
            const editable = canEditCard(card);

            return (
              <SpaceKanbanCard
                key={card.id}
                variant={variant}
                card={card}
                today={today}
                href={taskHrefs[card.id]}
                draggable={isDesktop && editable}
                editable={editable}
                teamId={teamId}
                onChanged={onChanged}
              />
            );
          })
        )}

        {status === "done" && (doneOlderCount > 0 || expanded) ? (
          <button
            type="button"
            disabled={loadingOlder}
            onClick={onToggleOlder}
            className="mt-2 block w-full border-t border-dashed border-[#e1e3e6] px-2 pb-0.5 pt-[9px] text-left"
          >
            <span className="text-[12px] font-medium text-[#7d2ae8]">
              {expanded
                ? `已显示全部 ${count} 项 · 收起`
                : `查看更早 ${doneOlderCount} 项已完成 →`}
            </span>
            <span className="mt-0.5 block text-[11px] text-[#9aa0a6]">
              {expanded ? "点击收起恢复近 7 天视图" : "点击原地展开全部已完成任务，可再次收起"}
            </span>
          </button>
        ) : null}
      </div>
    </section>
  );
}

/** 在本地看板中按 id 查找卡片（含已展开的更早 done 卡）。 */
function findCard(board: LocalBoard, cardId: string): BoardCard | undefined {
  return (
    board.todo.find((card) => card.id === cardId) ??
    board.inProgress.find((card) => card.id === cardId) ??
    board.doneRecent.find((card) => card.id === cardId) ??
    board.doneOlder.find((card) => card.id === cardId)
  );
}

/** 从全部列中移除卡片并放入目标列（done 置顶，活跃列垫底）。 */
function moveCard(
  board: LocalBoard,
  cardId: string,
  status: TaskStatus,
): LocalBoard {
  const card = findCard(board, cardId);
  if (!card) return board;

  const strip = (cards: BoardCard[]) =>
    cards.filter((item) => item.id !== cardId);

  const next: LocalBoard = {
    ...board,
    todo: strip(board.todo),
    inProgress: strip(board.inProgress),
    doneRecent: strip(board.doneRecent),
    doneOlder: strip(board.doneOlder),
  };

  const moved: BoardCard = {
    ...card,
    status,
    completedAt:
      status === "done"
        ? (card.completedAt ?? new Date().toISOString())
        : null,
  };

  if (status === "todo") {
    next.todo = [...next.todo, moved];
  } else if (status === "in_progress") {
    next.inProgress = [...next.inProgress, moved];
  } else {
    next.doneRecent = [moved, ...next.doneRecent];
  }

  return next;
}

/**
 * 空间级 Kanban（个人 / 团队共用，对照 `space-kanban-*.html`）。
 *
 * - 三列「待办 / 进行中 / 已完成」，跨项目聚合；
 * - ≥861px 可拖拽（团队卡需 `canEditTask`），拖卡落列即乐观更新状态，
 *   失败回滚并 `message.error`；拖拽只改状态、不改项目；
 * - <861px 单列堆叠，卡内状态按钮完成流转；
 * - done 列默认只显示近 7 天，尾部「查看更早」原地展开全部已完成任务。
 */
export function SpaceKanban({
  variant,
  board,
  today,
  teamId,
  teamSlug,
  role,
  actorId,
  taskHrefs,
  expandFilter,
}: SpaceKanbanProps) {
  const router = useRouter();
  const isDesktop = useIsDesktop();

  const [local, setLocal] = useState<LocalBoard>(() => toLocalBoard(board));
  const [syncedBoard, setSyncedBoard] = useState(board);
  // 展开状态不进 URL；任何触发 router.refresh() 的成功操作（如拖拽）会经
  // 渲染期同步重置展开视图，属预期行为。
  const [expanded, setExpanded] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);

  // 服务端刷新（router.refresh）后以最新 props 为准；展开状态一并回到 7 天视图。
  // 渲染期同步 props → state 是 React 推荐的写法，避免 effect 多跑一轮渲染。
  if (board !== syncedBoard) {
    setSyncedBoard(board);
    setLocal(toLocalBoard(board));
    setExpanded(false);
  }

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor),
  );

  const weekStart = getWeekStart(today);

  /** 编辑权只看角色 / 责任人，与视口无关；个人空间恒可编辑。 */
  function canEditCard(card: BoardCard): boolean {
    if (variant === "personal") return true;

    return canEditTask({
      role: role ?? null,
      actorId: actorId ?? "",
      assigneeId: card.assigneeId ?? null,
    });
  }

  function applyStatus(cardId: string, status: TaskStatus) {
    setLocal((current) => moveCard(current, cardId, status));
  }

  async function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over) return;

    const cardId = String(active.id);
    const nextStatus = String(over.id) as TaskStatus;
    if (!STATUS_ORDER.includes(nextStatus)) return;

    const card = findCard(local, cardId);
    if (!card || card.status === nextStatus) return;

    // 防御性再判一次：member 拖他人 / 未指派卡静默返回。
    if (!canEditCard(card)) return;

    // 失败回滚用功能式更新把卡移回原列（originalStatus 在乐观移动前捕获）：
    // 乐观移动与回滚之间落地的其他状态变更不会被旧快照覆盖。
    const originalStatus = card.status;
    applyStatus(cardId, nextStatus);

    try {
      let errors: Record<string, string> | null = null;

      if (variant === "personal") {
        const result = await updatePersonalTaskAction(cardId, {
          status: nextStatus,
        });
        if (!result.ok) errors = result.errors;
      } else if (teamId) {
        const result = await updateTeamTaskAction(cardId, {
          teamId,
          status: nextStatus,
        });
        if (!result.ok) errors = result.errors;
      } else {
        setLocal((current) => moveCard(current, cardId, originalStatus));
        return;
      }

      if (errors) {
        setLocal((current) => moveCard(current, cardId, originalStatus));
        message.error(firstError(errors));
        return;
      }

      router.refresh();
    } catch {
      setLocal((current) => moveCard(current, cardId, originalStatus));
      message.error("网络异常，请稍后重试");
    }
  }

  async function toggleOlderDone() {
    if (expanded) {
      setExpanded(false);
      return;
    }

    if (local.doneOlderCount === 0) return;

    // 已缓存过更早列表时直接复用，无需再次请求。
    if (local.doneOlder.length > 0) {
      setExpanded(true);
      return;
    }

    setLoadingOlder(true);
    try {
      // 展开取数必须沿用当前 URL 筛选，否则「更早」列表会把过滤外的卡混进来。
      const result = await getOlderDoneTasksAction(
        variant === "team"
          ? {
              spaceType: "team",
              teamSlug: teamSlug ?? "",
              ...(expandFilter ?? {}),
            }
          : {
              spaceType: "personal",
              ...(expandFilter?.projectSlug
                ? { projectSlug: expandFilter.projectSlug }
                : {}),
            },
      );

      if (!result.ok) {
        message.error("加载失败，请重试");
        return;
      }

      // 团队分支的运行期载荷是 TeamKanbanCardItem[]：producer 为
      // getOlderDoneTeamTasks()，且 Server Action 序列化保留全部自有属性；
      // 冻结签名是 KanbanCardItem[]，故此处按运行期保证收窄。
      const older =
        variant === "team"
          ? (result.data as TeamKanbanCardItem[])
          : result.data;

      setLocal((current) => ({ ...current, doneOlder: older }));
      setExpanded(true);
    } catch {
      message.error("加载失败，请重试");
    } finally {
      setLoadingOlder(false);
    }
  }

  const doneCards = expanded
    ? [...local.doneRecent, ...local.doneOlder]
    : local.doneRecent;

  const weekDoneCount = local.doneRecent.filter(
    (card) =>
      card.completedAt !== null &&
      completedThisWeek(card.completedAt, weekStart),
  ).length;

  const columns: Record<
    TaskStatus,
    { cards: BoardCard[]; count: number; overdueCount: number }
  > = {
    todo: {
      cards: local.todo,
      count: local.todo.length,
      overdueCount: local.todo.filter(
        (card) => card.dueDate !== null && card.dueDate < today,
      ).length,
    },
    in_progress: {
      cards: local.inProgress,
      count: local.inProgress.length,
      overdueCount: local.inProgress.filter(
        (card) => card.dueDate !== null && card.dueDate < today,
      ).length,
    },
    done: {
      cards: doneCards,
      // done 列头显示全部已完成数（原型口径：近 7 天 + 更早），不是可见卡片数。
      // 用 recent.length + doneOlderCount 而非 board.doneTotal：乐观移动会重排
      // recent / older 而不动 doneTotal，派生值可随乐观更新自愈，免等 refresh。
      count: local.doneRecent.length + local.doneOlderCount,
      overdueCount: 0,
    },
  };

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCorners}
      onDragEnd={(event) => {
        void handleDragEnd(event);
      }}
    >
      <div className="grid min-w-0 grid-cols-1 items-start gap-4 min-[861px]:grid-cols-3">
        {STATUS_ORDER.map((status) => {
          const column = columns[status];

          return (
            <SpaceKanbanColumn
              key={status}
              variant={variant}
              status={status}
              cards={column.cards}
              today={today}
              count={column.count}
              overdueCount={column.overdueCount}
              weekDoneCount={weekDoneCount}
              doneOlderCount={local.doneOlderCount}
              expanded={expanded}
              loadingOlder={loadingOlder}
              onToggleOlder={() => {
                void toggleOlderDone();
              }}
              taskHrefs={taskHrefs}
              teamId={teamId}
              isDesktop={isDesktop}
              canEditCard={canEditCard}
              onChanged={() => router.refresh()}
            />
          );
        })}
      </div>
    </DndContext>
  );
}
