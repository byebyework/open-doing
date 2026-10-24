"use client";

import type { NotificationType } from "@open-doing/types";
import {
  Badge,
  Button,
  Empty,
  Popover,
  Typography,
  message,
  theme,
  type GlobalToken,
} from "antd";
import dayjs from "dayjs";
import "dayjs/locale/zh-cn";
import relativeTime from "dayjs/plugin/relativeTime";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import { markAllNotificationsReadAction, markNotificationReadAction } from "../actions";
import type { NotificationListItem } from "../queries";
import { formatNotificationBody } from "./notification-format";

// 客户端组件内显式注册相对时间插件与中文 locale（服务端 Providers 同样设置，幂等）。
dayjs.extend(relativeTime);
dayjs.locale("zh-cn");

/** 轮询间隔：30 秒。 */
const POLL_INTERVAL_MS = 30_000;
/** 弹层宽度（与原型 360px 对齐，窄屏时收敛到视口内）。 */
const POPOVER_WIDTH = 360;
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

/** 通知类型 → 图标配色（只用 antd 设计令牌，不写死颜色值）。 */
function typeColors(
  type: NotificationType,
  token: GlobalToken,
): { color: string; background: string } {
  switch (type) {
    case "team_invite":
      // 未读行背景也是 colorPrimaryBg，图标改用同色系的深一档令牌保持可见。
      return { color: token.colorPrimary, background: token.colorPrimaryBgHover };
    case "task_assigned":
      return { color: token.colorInfo, background: token.colorInfoBg };
    case "task_due_soon":
      return { color: token.colorWarning, background: token.colorWarningBg };
    case "task_overdue":
      return { color: token.colorError, background: token.colorErrorBg };
    case "task_commented":
      return { color: token.colorSuccess, background: token.colorSuccessBg };
    case "task_changed_by_admin":
      return { color: token.colorTextSecondary, background: token.colorFillSecondary };
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

/** 六种通知类型各自的线性图标（原型 `notif-pop` 同款）。 */
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
  const { token } = theme.useToken();
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
        message.error(result.errors.form ?? "操作失败，请稍后重试");
        return;
      }

      setUnreadCount(result.data.unreadCount);
      setItems((previous) =>
        previous.map((item) => (item.read ? item : { ...item, read: true })),
      );
    } catch {
      message.error("网络异常，请稍后重试");
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

  const content = (
    <div style={{ width: POPOVER_WIDTH, maxWidth: "calc(100vw - 32px)" }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 8,
          padding: "4px 4px 10px",
          borderBottom: `1px solid ${token.colorBorderSecondary}`,
        }}
      >
        <span style={{ fontSize: 14, fontWeight: 700, color: token.colorText }}>通知</span>
        <Button
          type="text"
          size="small"
          disabled={unreadCount === 0}
          loading={markingAll}
          onClick={() => {
            void handleMarkAllRead();
          }}
        >
          全部已读
        </Button>
      </div>

      <div style={{ maxHeight: LIST_MAX_HEIGHT, overflowY: "auto" }}>
        {items.length === 0 ? (
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description="暂无通知"
            style={{ margin: "24px 0" }}
          />
        ) : (
          items.map((item) => {
            const body = formatNotificationBody(item);
            const colors = typeColors(item.type, token);

            return (
              <button
                key={item.id}
                type="button"
                onClick={() => {
                  void handleItemClick(item);
                }}
                style={{
                  display: "flex",
                  alignItems: "flex-start",
                  gap: 10,
                  width: "100%",
                  padding: "12px 16px",
                  border: "none",
                  borderBottom: `1px solid ${token.colorBorderSecondary}`,
                  background: item.read ? "transparent" : token.colorPrimaryBg,
                  cursor: "pointer",
                  textAlign: "left",
                }}
              >
                <span
                  style={{
                    display: "grid",
                    placeItems: "center",
                    width: 30,
                    height: 30,
                    borderRadius: 9999,
                    flex: "none",
                    color: colors.color,
                    background: colors.background,
                  }}
                >
                  <NotificationTypeIcon type={item.type} />
                </span>

                <span style={{ flex: 1, minWidth: 0 }}>
                  <Typography.Text
                    style={{ fontSize: 12.5, lineHeight: 1.5, color: token.colorText }}
                  >
                    {body.parts.map((part, index) =>
                      part.bold ? (
                        <b key={index} style={{ fontWeight: 600 }}>
                          {part.text}
                        </b>
                      ) : (
                        <span key={index}>{part.text}</span>
                      ),
                    )}
                  </Typography.Text>
                  <span
                    style={{
                      display: "block",
                      marginTop: 2,
                      fontSize: 11,
                      color: token.colorTextTertiary,
                    }}
                  >
                    {dayjs(item.createdAt).fromNow()}
                  </span>
                </span>
              </button>
            );
          })
        )}
      </div>
    </div>
  );

  return (
    <Popover
      content={content}
      trigger="click"
      placement="bottomRight"
      arrow={false}
      styles={{ content: { padding: 0 } }}
    >
      <Button
        type="text"
        shape="circle"
        aria-label={
          unreadCount > 0 ? `通知，${unreadCount} 条未读` : "通知"
        }
        icon={
          <Badge count={unreadCount} size="small" offset={[2, -2]}>
            <BellIcon />
          </Badge>
        }
      />
    </Popover>
  );
}
