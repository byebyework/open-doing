"use client";

import type { NotificationType } from "@open-doing/types";
import dayjs from "dayjs";
import relativeTime from "dayjs/plugin/relativeTime";
import { Loader2Icon } from "lucide-react";
import { useMessages, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

import { EmptyState } from "@/components/ui/EmptyState";
import { Button } from "@/components/ui/shadcn/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/shadcn/popover";
import { createTranslator } from "@/i18n/translate";

import { markAllNotificationsReadAction, markNotificationReadAction } from "../actions";
import type { NotificationListItem } from "../queries";
import { formatNotificationBody } from "./notification-format";

// 相对时间插件全局注册一次；dayjs locale 由根 Providers 按当前语言统一设置。
dayjs.extend(relativeTime);

/** 轮询间隔：30 秒。 */
const POLL_INTERVAL_MS = 30_000;
/** 列表最大高度（与原型一致，超出滚动）。 */
const LIST_MAX_HEIGHT = 340;

/** 轮询接口的期望载荷（已通过结构校验）。 */
interface NotificationPollPayload {
  unreadCount: number;
  items: NotificationListItem[];
}

/**
 * 解析 `GET /api/notifications` 的响应体。
 *
 * 服务端偶发非 JSON 的 500 时 `response.json()` 会抛错，调用方按瞬时失败处理；
 * 这里再做一层结构校验，异常载荷直接丢弃，避免把坏数据写进状态。
 */
function parsePollPayload(data: unknown): NotificationPollPayload | null {
  if (typeof data !== "object" || data === null) {
    return null;
  }

  const payload = data as { ok?: unknown; unreadCount?: unknown; items?: unknown };
  if (
    payload.ok !== true ||
    typeof payload.unreadCount !== "number" ||
    !Array.isArray(payload.items)
  ) {
    return null;
  }

  return {
    unreadCount: payload.unreadCount,
    items: payload.items as NotificationListItem[],
  };
}

/** 通知类型 → 图标配色（只用 design tokens，对齐原型 `notif-pop` 形态）。 */
function typeColors(
  type: NotificationType,
): { color: string; background: string } {
  switch (type) {
    case "team_invite":
      // 未读行背景也是淡紫系，图标用品牌主色保持可见。
      return { color: "var(--primary)", background: "var(--accent-lavender-bg)" };
    case "team_join_requested":
      // 待审批的待办感：与邀请同色系。
      return { color: "var(--primary)", background: "var(--accent-lavender-bg)" };
    case "team_join_approved":
      return { color: "var(--success-500)", background: "var(--success-bg)" };
    case "team_join_declined":
      return { color: "var(--color-text-faint)", background: "var(--muted)" };
    case "task_assigned":
      return { color: "var(--info-500)", background: "var(--info-bg)" };
    case "task_due_soon":
      return { color: "var(--warning-500)", background: "var(--warning-bg)" };
    case "task_overdue":
      return { color: "var(--error-500)", background: "var(--error-bg)" };
    case "task_commented":
      return { color: "var(--success-500)", background: "var(--success-bg)" };
    case "task_changed_by_admin":
      return { color: "var(--color-text-faint)", background: "var(--muted)" };
  }
}

/** 铃铛图标（与原型同款线性铃铛）。 */
function BellIcon() {
  return (
    <svg
      width="19"
      height="19"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
      <path d="M13.7 21a2 2 0 0 1-3.4 0" />
    </svg>
  );
}

/** 各通知类型的线性图标（原型 `notif-pop` 同款；join 系列沿用同一线条风格）。 */
function NotificationTypeIcon({ type }: { type: NotificationType }) {
  const common = {
    width: 14,
    height: 14,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 2,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
  };

  switch (type) {
    case "team_invite":
      return (
        <svg {...common}>
          <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
          <circle cx="9" cy="7" r="4" />
          <path d="M19 8v6M22 11h-6" />
        </svg>
      );
    case "team_join_requested":
      return (
        <svg {...common}>
          <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
          <circle cx="9" cy="7" r="4" />
          <path d="M17 11h5" />
          <path d="M19 8l3 3-3 3" />
        </svg>
      );
    case "team_join_approved":
      return (
        <svg {...common}>
          <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
          <circle cx="9" cy="7" r="4" />
          <path d="M16 11.5l2 2 4-4" />
        </svg>
      );
    case "team_join_declined":
      return (
        <svg {...common}>
          <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
          <circle cx="9" cy="7" r="4" />
          <path d="M17 9l5 5" />
          <path d="M22 9l-5 5" />
        </svg>
      );
    case "task_assigned":
      return (
        <svg {...common}>
          <path d="M9 11l3 3L22 4" />
          <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
        </svg>
      );
    case "task_due_soon":
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="9" />
          <path d="M12 7v5l3 2" />
        </svg>
      );
    case "task_overdue":
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="9" />
          <path d="M12 8v5" />
          <path d="M12 16.5h.01" />
        </svg>
      );
    case "task_commented":
      return (
        <svg {...common}>
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
        </svg>
      );
    case "task_changed_by_admin":
      return (
        <svg {...common}>
          <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
          <path d="M18.5 2.5a2.1 2.1 0 0 1 3 3L12 15l-4 1 1-4z" />
        </svg>
      );
  }
}

/**
 * 顶栏通知中心（N-2）：未读角标 + 点击弹出的通知列表。
 *
 * 行为：
 * - 挂载后立即拉取一次 `GET /api/notifications`，随后每 30 秒轮询；
 *   `visibilitychange` 回到可见时立即补拉一次，卸载时 abort + 清理定时器/监听；
 * - 未登录（401）静默停止轮询，不打断顶栏其余交互；
 * - 角标与列表各自渲染服务端返回的 `unreadCount` / `items`，不做客户端对账；
 * - 点击单条：未读则先调 `markNotificationReadAction`（失败仅记录，不阻塞跳转），
 *   有 `href` 时 `router.push`，无 `href` 时只标记已读；
 * - 「全部已读」调 `markAllNotificationsReadAction` 并按返回值更新本地状态。
 *
 * 已知偏差：原型底部的「查看全部通知」链接在 v1 没有独立通知页，按计划省略。
 */
export function NotificationBell() {
  const router = useRouter();
  const t = useTranslations("notifications");
  const tCommon = useTranslations("common");
  const tErrors = useTranslations("errors");
  // formatNotificationBody 需要 TranslateFn 口径的取词函数（key 为 string），
  // 用同一份 messages 的 notifications 子树构造，与 next-intl 运行时同源。
  const tCopy = createTranslator(useMessages().notifications);
  const [items, setItems] = useState<NotificationListItem[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [pollingStopped, setPollingStopped] = useState(false);
  const [markingAll, setMarkingAll] = useState(false);

  const refresh = useCallback(async (signal?: AbortSignal) => {
    try {
      const response = await fetch("/api/notifications", {
        cache: "no-store",
        signal,
      });

      if (response.status === 401) {
        // 未登录：静默停轮询，避免每 30 秒持续打 401。
        setPollingStopped(true);
        return;
      }

      if (!response.ok) {
        // 5xx 等瞬时失败：保留上一次状态，等待下一轮。
        return;
      }

      const data = await response.json().catch(() => null);
      const payload = parsePollPayload(data);
      if (!payload) {
        return;
      }

      setItems(payload.items);
      setUnreadCount(payload.unreadCount);
    } catch (error) {
      // 网络错误 / 请求被 abort：静默，保留上一次状态。
      if (error instanceof DOMException && error.name === "AbortError") {
        return;
      }
    }
  }, []);

  useEffect(() => {
    if (pollingStopped) {
      return;
    }

    const controller = new AbortController();
    const poll = () => {
      void refresh(controller.signal);
    };

    // 首次拉取放到下一轮事件循环：effect 体内同步触发 setState 会级联渲染，
    // 且此时属于「订阅外部系统后在回调中更新状态」的推荐形态。
    const initialTimer = window.setTimeout(poll, 0);
    const timer = window.setInterval(poll, POLL_INTERVAL_MS);

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        poll();
      }
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      controller.abort();
      window.clearTimeout(initialTimer);
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [pollingStopped, refresh]);

  async function handleMarkAllRead() {
    if (markingAll || unreadCount === 0) {
      return;
    }

    setMarkingAll(true);
    try {
      const result = await markAllNotificationsReadAction();
      if (!result.ok) {
        toast.error(result.errors.form ?? tErrors("operationFailed"));
        return;
      }

      setUnreadCount(result.data.unreadCount);
      setItems((previous) =>
        previous.map((item) => (item.read ? item : { ...item, read: true })),
      );
    } catch {
      toast.error(tCommon("networkError"));
    } finally {
      setMarkingAll(false);
    }
  }

  async function handleItemClick(item: NotificationListItem) {
    if (!item.read) {
      try {
        const result = await markNotificationReadAction(item.id);
        if (result.ok) {
          setUnreadCount(result.data.unreadCount);
          setItems((previous) =>
            previous.map((current) =>
              current.id === item.id ? { ...current, read: true } : current,
            ),
          );
        }
      } catch (error) {
        // 标记失败不阻塞跳转；下一轮轮询会以服务端状态为准。
        console.error("[notifications] 标记通知已读失败", error);
      }
    }

    if (item.href) {
      router.push(item.href);
    }
  }

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          data-testid="notification-bell-button"
          aria-label={
            unreadCount > 0
              ? t("ariaLabelUnread", { count: unreadCount })
              : t("ariaLabel")
          }
          className="relative grid size-9 place-items-center rounded-full text-[var(--ink-500)] transition-colors outline-none hover:bg-[#f4f5f7] focus-visible:ring-[3px] focus-visible:ring-ring/40"
        >
          <BellIcon />
          {unreadCount > 0 ? (
            // 角标形态对齐原型 `.notif-dot`：错误色 pill、卡片色描边。
            <span className="absolute top-[7px] right-[7px] grid h-[15px] min-w-[15px] place-items-center rounded-[var(--radius-pill)] border-2 border-[var(--card)] bg-[var(--error)] px-[3px] text-[9.5px] font-bold leading-none text-white">
              {unreadCount > 99 ? "99+" : unreadCount}
            </span>
          ) : null}
        </button>
      </PopoverTrigger>

      <PopoverContent
        align="end"
        className="w-[360px] max-w-[calc(100vw-32px)] p-0"
      >
        <div className="flex items-center justify-between gap-2 border-b border-[var(--border)] px-4 py-[13px]">
          <span className="text-[14px] font-bold text-[var(--ink-900)]">
            {t("bellTitle")}
          </span>
          <Button
            variant="ghost"
            size="sm"
            disabled={unreadCount === 0 || markingAll}
            onClick={() => {
              void handleMarkAllRead();
            }}
          >
            {markingAll ? (
              <Loader2Icon className="animate-spin" aria-hidden="true" />
            ) : null}
            {t("markAllRead")}
          </Button>
        </div>

        <div className="max-h-[340px] overflow-y-auto">
          {items.length === 0 ? (
            <EmptyState title={t("empty")} />
          ) : (
            items.map((item) => {
              const body = formatNotificationBody(item, tCopy);
              const colors = typeColors(item.type);

              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => {
                    void handleItemClick(item);
                  }}
                  className={`flex w-full items-start gap-2.5 border-b border-[var(--border)] px-4 py-3 text-left transition-colors last:border-b-0 hover:bg-[var(--muted)] ${
                    item.read ? "bg-transparent" : "bg-[var(--surface-cool)]"
                  }`}
                >
                  <span
                    className="grid size-[30px] flex-none place-items-center rounded-full"
                    style={{ color: colors.color, background: colors.background }}
                  >
                    <NotificationTypeIcon type={item.type} />
                  </span>

                  <span className="min-w-0 flex-1">
                    <span className="block text-[12.5px] leading-[1.5] text-[var(--ink-900)]">
                      {body.parts.map((part, index) =>
                        part.bold ? (
                          <b key={index} className="font-semibold">
                            {part.text}
                          </b>
                        ) : (
                          <span key={index}>{part.text}</span>
                        ),
                      )}
                    </span>
                    <span className="mt-0.5 block text-[11px] text-[var(--color-text-faint)]">
                      {dayjs(item.createdAt).fromNow()}
                    </span>
                  </span>
                </button>
              );
            })
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
