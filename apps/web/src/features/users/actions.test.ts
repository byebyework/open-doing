import { afterEach, describe, expect, it, vi } from "vitest";

import { getCurrentUser } from "@/features/auth/session";

import { updateLanguageAction, updateReminderPrefsAction } from "./actions";
import { updateUserLanguage } from "./service";

/**
 * actions 层只负责 session -> service -> cookie 的衔接与错误映射
 * （mock service / session / cookies；真实数据库覆盖在 service.test.ts）。
 */
const cookieSet = vi.fn();

vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({
    set: cookieSet,
    get: vi.fn(),
  })),
}));

vi.mock("@/features/auth/session", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/features/auth/session")>();
  return { ...actual, getCurrentUser: vi.fn() };
});

vi.mock("./service", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./service")>();
  return { ...actual, updateUserLanguage: vi.fn() };
});

const mockGetCurrentUser = vi.mocked(getCurrentUser);
const mockUpdateUserLanguage = vi.mocked(updateUserLanguage);

const currentUser = {
  id: "user-id",
  uid: "doing_x7k2m9",
  username: "alice",
  createdAt: "2026-10-01T00:00:00.000Z",
};

describe("切换界面语言 action", () => {
  afterEach(() => {
    vi.resetAllMocks();
  });

  it("未登录：返回「请先登录」，不触达 service / 不写 cookie", async () => {
    mockGetCurrentUser.mockResolvedValue(null);

    expect(await updateLanguageAction({ language: "en" })).toEqual({
      ok: false,
      errors: { form: "请先登录" },
    });
    expect(mockUpdateUserLanguage).not.toHaveBeenCalled();
    expect(cookieSet).not.toHaveBeenCalled();
  });

  it("已登录：更新 DB 并把 od_locale cookie 写为对应语言", async () => {
    mockGetCurrentUser.mockResolvedValue(currentUser);
    mockUpdateUserLanguage.mockResolvedValue("en");

    expect(await updateLanguageAction({ language: "en" })).toEqual({
      ok: true,
      data: undefined,
    });
    expect(mockUpdateUserLanguage).toHaveBeenCalledWith({
      userId: currentUser.id,
      language: "en",
    });
    expect(cookieSet).toHaveBeenCalledWith(
      "od_locale",
      "en",
      expect.objectContaining({ path: "/" }),
    );
  });

  it("非法语言值：返回表单错误，不触达 service", async () => {
    mockGetCurrentUser.mockResolvedValue(currentUser);

    const result = await updateLanguageAction({ language: "fr" });
    expect(result).toMatchObject({
      ok: false,
      errors: { form: expect.any(String) },
    });
    expect(mockUpdateUserLanguage).not.toHaveBeenCalled();
    expect(cookieSet).not.toHaveBeenCalled();
  });
});
