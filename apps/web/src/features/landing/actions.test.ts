import { beforeEach, describe, expect, it, vi } from "vitest";

import { getCurrentUser } from "@/features/auth/session";
import { LOCALE_COOKIE, LOCALE_COOKIE_MAX_AGE } from "@/i18n/config";
import { revalidatePath } from "next/cache";

import { setAnonymousLocaleAction } from "./actions";

/**
 * 匿名语言切换只写 cookie + 刷新落地页,不查会话也不写库。
 * mock cookies / revalidatePath / 会话(仅供 failed locale 的翻译兜底解析),
 * 验证成功路径的 cookie 参数与非法 locale 的零副作用。
 */
const { cookieSet, cookieGet } = vi.hoisted(() => ({
  cookieSet: vi.fn(),
  cookieGet: vi.fn(),
}));

vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({ set: cookieSet, get: cookieGet })),
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

vi.mock("@/features/auth/session", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/features/auth/session")>();
  return { ...actual, getCurrentUser: vi.fn() };
});

const mockGetCurrentUser = vi.mocked(getCurrentUser);
const mockRevalidatePath = vi.mocked(revalidatePath);

describe("匿名语言切换 action", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetCurrentUser.mockResolvedValue(null);
  });

  it("合法 locale:返回成功、写入 od_locale cookie 并刷新落地页", async () => {
    expect(await setAnonymousLocaleAction({ locale: "en" })).toEqual({
      ok: true,
      data: undefined,
    });
    expect(cookieSet).toHaveBeenCalledWith(LOCALE_COOKIE, "en", {
      path: "/",
      maxAge: LOCALE_COOKIE_MAX_AGE,
      sameSite: "lax",
    });
    expect(mockRevalidatePath).toHaveBeenCalledWith("/");
  });

  it("非法 locale:返回表单错误,不写 cookie、不刷新", async () => {
    expect(
      await setAnonymousLocaleAction({ locale: "fr" }),
    ).toMatchObject({
      ok: false,
      errors: { form: expect.any(String) },
    });
    expect(cookieSet).not.toHaveBeenCalled();
    expect(mockRevalidatePath).not.toHaveBeenCalled();
  });
});
