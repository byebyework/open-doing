import { afterEach, describe, expect, it, vi } from "vitest";

import { getCurrentUser } from "@/features/auth/session";

import { markAllNotificationsReadAction, markNotificationReadAction } from "./actions";
import {
  getUnreadNotificationCount,
  markAllNotificationsRead,
  markNotificationRead,
} from "./queries";

/**
 * actions 层只负责 session -> userId -> queries 的衔接与结果映射
 * （queries 的真实数据库行为已在 queries.test.ts 覆盖）。
 */
vi.mock("@/features/auth/session", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/features/auth/session")>();
  return { ...actual, getCurrentUser: vi.fn() };
});

vi.mock("./queries", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./queries")>();
  return {
    ...actual,
    getUnreadNotificationCount: vi.fn(),
    markAllNotificationsRead: vi.fn(),
    markNotificationRead: vi.fn(),
  };
});

const mockGetCurrentUser = vi.mocked(getCurrentUser);
const mockGetUnreadCount = vi.mocked(getUnreadNotificationCount);
const mockMarkAll = vi.mocked(markAllNotificationsRead);
const mockMarkOne = vi.mocked(markNotificationRead);

const fakeUser = {
  id: "00000000-0000-0000-0000-000000000001",
  uid: "doing_x7k2m9",
  username: "member",
  createdAt: "2026-10-01T00:00:00.000Z",
};

describe("通知 actions", () => {
  afterEach(() => {
    vi.resetAllMocks();
    vi.restoreAllMocks();
  });

  it("markNotificationReadAction：未登录返回「请先登录」，不查库", async () => {
    mockGetCurrentUser.mockResolvedValue(null);

    expect(await markNotificationReadAction("notification-id")).toEqual({
      ok: false,
      errors: { form: "请先登录" },
    });
    expect(mockMarkOne).not.toHaveBeenCalled();
  });

  it("markAllNotificationsReadAction：未登录返回「请先登录」，不查库", async () => {
    mockGetCurrentUser.mockResolvedValue(null);

    expect(await markAllNotificationsReadAction()).toEqual({
      ok: false,
      errors: { form: "请先登录" },
    });
    expect(mockMarkAll).not.toHaveBeenCalled();
  });

  it("markAllNotificationsReadAction：以会话用户置已读并返回最新未读数", async () => {
    mockGetCurrentUser.mockResolvedValue(fakeUser);
    mockMarkAll.mockResolvedValue(2);
    mockGetUnreadCount.mockResolvedValue(0);

    expect(await markAllNotificationsReadAction()).toEqual({
      ok: true,
      data: { unreadCount: 0 },
    });
    expect(mockMarkAll).toHaveBeenCalledWith(fakeUser.id);
    expect(mockGetUnreadCount).toHaveBeenCalledWith(fakeUser.id);
  });

  it("markNotificationReadAction：本人通知置已读并返回最新未读数", async () => {
    mockGetCurrentUser.mockResolvedValue(fakeUser);
    mockMarkOne.mockResolvedValue(true);
    mockGetUnreadCount.mockResolvedValue(3);

    expect(await markNotificationReadAction("notification-id")).toEqual({
      ok: true,
      data: { unreadCount: 3 },
    });
    expect(mockMarkOne).toHaveBeenCalledWith({
      userId: fakeUser.id,
      notificationId: "notification-id",
    });
    expect(mockGetUnreadCount).toHaveBeenCalledWith(fakeUser.id);
  });

  it("markNotificationReadAction：他人/不存在的通知返回失败，不重算未读数", async () => {
    mockGetCurrentUser.mockResolvedValue(fakeUser);
    mockMarkOne.mockResolvedValue(false);

    expect(await markNotificationReadAction("someone-elses-id")).toEqual({
      ok: false,
      errors: { form: "通知不存在或已被删除" },
    });
    expect(mockGetUnreadCount).not.toHaveBeenCalled();
  });

  it("markNotificationReadAction：查询异常返回通用提示", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    mockGetCurrentUser.mockResolvedValue(fakeUser);
    mockMarkOne.mockRejectedValue(new Error("db down"));

    expect(await markNotificationReadAction("notification-id")).toEqual({
      ok: false,
      errors: { form: "操作失败，请稍后重试" },
    });
  });
});
