import { afterEach, describe, expect, it, vi } from "vitest";

import { getCurrentUser } from "@/features/auth/session";

import {
  updateLanguageAction,
  updateProfileAction,
  updateReminderPrefsAction,
} from "./actions";
import {
  updateProfile,
  updateUserLanguage,
  UserError,
  type UserProfile,
} from "./service";

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
  return { ...actual, updateUserLanguage: vi.fn(), updateProfile: vi.fn() };
});

const mockGetCurrentUser = vi.mocked(getCurrentUser);
const mockUpdateUserLanguage = vi.mocked(updateUserLanguage);
const mockUpdateProfile = vi.mocked(updateProfile);

const currentUser = {
  id: "user-id",
  uid: "doing_x7k2m9",
  username: "alice",
  nickname: null,
  gender: null,
  email: null,
  phone: null,
  isAdmin: false,
  isDisabled: false,
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

const updatedProfile: UserProfile = {
  nickname: "阿岚",
  gender: "female",
  email: "lan@example.com",
  phone: "13800138000",
};

describe("更新个人资料 action", () => {
  afterEach(() => {
    vi.resetAllMocks();
  });

  it("未登录：返回「请先登录」，不触达 service（userId 只能来自会话）", async () => {
    mockGetCurrentUser.mockResolvedValue(null);

    expect(await updateProfileAction({ nickname: "阿岚" })).toEqual({
      ok: false,
      errors: { form: "请先登录" },
    });
    expect(mockUpdateProfile).not.toHaveBeenCalled();
  });

  it("已登录：userId 取自会话，trim 后转发，返回更新后的资料", async () => {
    mockGetCurrentUser.mockResolvedValue(currentUser);
    mockUpdateProfile.mockResolvedValue(updatedProfile);

    expect(
      await updateProfileAction({
        nickname: "  阿岚  ",
        gender: "female",
        email: "  LAN@example.com ",
        phone: " 13800138000 ",
      }),
    ).toEqual({ ok: true, data: updatedProfile });
    expect(mockUpdateProfile).toHaveBeenCalledWith({
      userId: currentUser.id,
      nickname: "阿岚",
      gender: "female",
      email: "LAN@example.com",
      phone: "13800138000",
    });
  });

  it("空字符串：昵称省略（保持现状），其它资料显式传 null（清空）", async () => {
    mockGetCurrentUser.mockResolvedValue(currentUser);
    mockUpdateProfile.mockResolvedValue(updatedProfile);

    await updateProfileAction({ nickname: "", gender: "", email: "", phone: "" });
    expect(mockUpdateProfile).toHaveBeenCalledWith({
      userId: currentUser.id,
      gender: null,
      email: null,
      phone: null,
    });
  });

  it("service 抛 UserError：按字段与 users.profile 命名空间 key 映射错误", async () => {
    mockGetCurrentUser.mockResolvedValue(currentUser);
    mockUpdateProfile.mockRejectedValue(
      new UserError("邮箱已被使用", "email", { key: "emailTaken" }),
    );

    expect(await updateProfileAction({ email: "taken@example.com" })).toEqual({
      ok: false,
      errors: { email: "邮箱已被使用" },
    });
  });
});
