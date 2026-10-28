import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { getSessionUserId } from "@/features/auth/session";
import {
  getUnreadNotificationCount,
  listNotifications,
  type NotificationListItem,
} from "@/features/notifications/queries";

import { GET } from "./route";

vi.mock("@/features/auth/session", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/features/auth/session")>();
  return { ...actual, getSessionUserId: vi.fn() };
});

vi.mock("@/features/notifications/queries", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/features/notifications/queries")>();
  return { ...actual, getUnreadNotificationCount: vi.fn(), listNotifications: vi.fn() };
});

const mockGetSessionUserId = vi.mocked(getSessionUserId);
const mockGetUnreadCount = vi.mocked(getUnreadNotificationCount);
const mockListNotifications = vi.mocked(listNotifications);

const userId = "00000000-0000-0000-0000-000000000001";

const item: NotificationListItem = {
  id: "00000000-0000-0000-0000-000000000002",
  type: "task_assigned",
  read: false,
  createdAt: "2026-10-24T08:00:00.000Z",
  actorName: "owner",
  teamName: "增长突击队",
  taskTitle: "上线落地页",
  href: "/space/growth-squad/projects/website-revamp/tasks/00000000-0000-0000-0000-000000000003",
};

function get(path = "/api/notifications") {
  return GET(new NextRequest(`http://localhost${path}`));
}

describe("GET /api/notifications", () => {
  afterEach(() => {
    vi.resetAllMocks();
  });

  it("未登录返回 401，不查通知", async () => {
    mockGetSessionUserId.mockResolvedValue(null);

    const response = await get();

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ ok: false });
    expect(mockListNotifications).not.toHaveBeenCalled();
    expect(mockGetUnreadCount).not.toHaveBeenCalled();
  });

  it("登录后返回未读数与本人通知列表（默认 20 条）", async () => {
    mockGetSessionUserId.mockResolvedValue(userId);
    mockGetUnreadCount.mockResolvedValue(1);
    mockListNotifications.mockResolvedValue([item]);

    const response = await get();

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, unreadCount: 1, items: [item] });
    expect(mockGetUnreadCount).toHaveBeenCalledWith(userId);
    expect(mockListNotifications).toHaveBeenCalledWith({ userId, limit: 20 });
  });

  it.each(["0", "-5", "abc", "101", "1.5"])(
    "非法 limit=%s 回落默认 20",
    async (limit) => {
      mockGetSessionUserId.mockResolvedValue(userId);
      mockGetUnreadCount.mockResolvedValue(0);
      mockListNotifications.mockResolvedValue([]);

      await get(`/api/notifications?limit=${limit}`);

      expect(mockListNotifications).toHaveBeenCalledWith({ userId, limit: 20 });
    },
  );

  it("合法 limit 透传（1..100）", async () => {
    mockGetSessionUserId.mockResolvedValue(userId);
    mockGetUnreadCount.mockResolvedValue(0);
    mockListNotifications.mockResolvedValue([]);

    await get("/api/notifications?limit=50");

    expect(mockListNotifications).toHaveBeenCalledWith({ userId, limit: 50 });
  });
});
