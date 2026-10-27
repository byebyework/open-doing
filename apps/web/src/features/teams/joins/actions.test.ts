import { afterEach, describe, expect, it, vi } from "vitest";

import { getCurrentUser } from "@/features/auth/session";
import { TeamPermissionError } from "@/features/teams/permissions";
import type { TeamJoinRequest } from "@open-doing/types";
import { revalidatePath } from "next/cache";

import {
  cancelJoinRequestAction,
  createJoinRequestAction,
  resetJoinCodeAction,
  respondToJoinRequestAction,
  setJoinCodeEnabledAction,
} from "./actions";
import {
  JoinError,
  cancelJoinRequest,
  createJoinRequest,
  resetJoinCode,
  respondToJoinRequest,
  setJoinCodeEnabled,
} from "./service";

/**
 * actions 层只负责 session -> actorId -> service 的衔接与错误映射
 * （mock service；真实数据库覆盖在 service.test.ts）。
 */
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

vi.mock("@/features/auth/session", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/features/auth/session")>();
  return { ...actual, getCurrentUser: vi.fn() };
});

vi.mock("./service", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./service")>();
  return {
    ...actual,
    createJoinRequest: vi.fn(),
    respondToJoinRequest: vi.fn(),
    cancelJoinRequest: vi.fn(),
    resetJoinCode: vi.fn(),
    setJoinCodeEnabled: vi.fn(),
  };
});

const mockGetCurrentUser = vi.mocked(getCurrentUser);
const mockRevalidatePath = vi.mocked(revalidatePath);
const mockCreateJoinRequest = vi.mocked(createJoinRequest);
const mockRespondToJoinRequest = vi.mocked(respondToJoinRequest);
const mockCancelJoinRequest = vi.mocked(cancelJoinRequest);
const mockResetJoinCode = vi.mocked(resetJoinCode);
const mockSetJoinCodeEnabled = vi.mocked(setJoinCodeEnabled);

const currentUser = {
  id: "user-id",
  uid: "doing_x7k2m9",
  username: "alice",
  createdAt: "2026-10-01T00:00:00.000Z",
};

const fakeJoinRequest: TeamJoinRequest = {
  id: "00000000-0000-0000-0000-000000000003",
  teamId: "00000000-0000-0000-0000-000000000001",
  userId: currentUser.id,
  status: "pending",
  createdAt: "2026-10-23T00:00:00.000Z",
};

describe("凭码加入 actions", () => {
  afterEach(() => {
    vi.resetAllMocks();
  });

  it("未登录：每个 action 都返回「请先登录」，且不触达 service / 不刷新缓存", async () => {
    mockGetCurrentUser.mockResolvedValue(null);

    expect(await createJoinRequestAction({ code: "K7M29XQ4" })).toEqual({
      ok: false,
      errors: { form: "请先登录" },
    });
    expect(
      await respondToJoinRequestAction({ requestId: fakeJoinRequest.id, approve: true }),
    ).toEqual({ ok: false, errors: { form: "请先登录" } });
    expect(await cancelJoinRequestAction({ requestId: fakeJoinRequest.id })).toEqual({
      ok: false,
      errors: { form: "请先登录" },
    });
    expect(await resetJoinCodeAction({ teamId: fakeJoinRequest.teamId })).toEqual({
      ok: false,
      errors: { form: "请先登录" },
    });
    expect(
      await setJoinCodeEnabledAction({ teamId: fakeJoinRequest.teamId, enabled: false }),
    ).toEqual({ ok: false, errors: { form: "请先登录" } });

    expect(mockCreateJoinRequest).not.toHaveBeenCalled();
    expect(mockRespondToJoinRequest).not.toHaveBeenCalled();
    expect(mockCancelJoinRequest).not.toHaveBeenCalled();
    expect(mockResetJoinCode).not.toHaveBeenCalled();
    expect(mockSetJoinCodeEnabled).not.toHaveBeenCalled();
    expect(mockRevalidatePath).not.toHaveBeenCalled();
  });

  describe("createJoinRequestAction", () => {
    it("成功：以会话用户为 actorId 调 service，透传申请并刷新布局", async () => {
      mockGetCurrentUser.mockResolvedValue(currentUser);
      mockCreateJoinRequest.mockResolvedValue(fakeJoinRequest);

      const result = await createJoinRequestAction({ code: "K7M29XQ4" });

      expect(result).toEqual({ ok: true, data: fakeJoinRequest });
      expect(mockCreateJoinRequest).toHaveBeenCalledWith({
        code: "K7M29XQ4",
        actorId: currentUser.id,
      });
      expect(mockRevalidatePath).toHaveBeenCalledWith("/", "layout");
    });

    it("JoinError(field=code) 映射为 code 字段错误，不刷新缓存", async () => {
      mockGetCurrentUser.mockResolvedValue(currentUser);
      mockCreateJoinRequest.mockRejectedValue(new JoinError("CODE_INVALID", "入群码无效", "code"));

      const result = await createJoinRequestAction({ code: "BADCODE1" });

      expect(result).toEqual({ ok: false, errors: { code: "入群码无效" } });
      expect(mockRevalidatePath).not.toHaveBeenCalled();
    });
  });

  describe("respondToJoinRequestAction", () => {
    it("成功：approve 透传并刷新布局", async () => {
      mockGetCurrentUser.mockResolvedValue(currentUser);
      mockRespondToJoinRequest.mockResolvedValue({ ...fakeJoinRequest, status: "approved" });

      const result = await respondToJoinRequestAction({
        requestId: fakeJoinRequest.id,
        approve: true,
      });

      expect(result).toMatchObject({ ok: true, data: { status: "approved" } });
      expect(mockRespondToJoinRequest).toHaveBeenCalledWith({
        requestId: fakeJoinRequest.id,
        actorId: currentUser.id,
        approve: true,
      });
      expect(mockRevalidatePath).toHaveBeenCalledWith("/", "layout");
    });

    it("JoinError(field=form) 映射为 form 错误", async () => {
      mockGetCurrentUser.mockResolvedValue(currentUser);
      mockRespondToJoinRequest.mockRejectedValue(
        new JoinError("INVALID", "加入申请不存在或已失效", "form"),
      );

      const result = await respondToJoinRequestAction({
        requestId: fakeJoinRequest.id,
        approve: false,
      });

      expect(result).toEqual({ ok: false, errors: { form: "加入申请不存在或已失效" } });
      expect(mockRevalidatePath).not.toHaveBeenCalled();
    });

    it("TeamPermissionError 映射为通用权限文案", async () => {
      mockGetCurrentUser.mockResolvedValue(currentUser);
      mockRespondToJoinRequest.mockRejectedValue(new TeamPermissionError("team:invite"));

      const result = await respondToJoinRequestAction({
        requestId: fakeJoinRequest.id,
        approve: true,
      });

      expect(result).toEqual({ ok: false, errors: { form: "没有权限执行该操作" } });
      expect(mockRevalidatePath).not.toHaveBeenCalled();
    });
  });

  describe("cancelJoinRequestAction", () => {
    it("成功：以会话用户为 actorId 撤回并刷新布局", async () => {
      mockGetCurrentUser.mockResolvedValue(currentUser);
      mockCancelJoinRequest.mockResolvedValue({ ...fakeJoinRequest, status: "cancelled" });

      const result = await cancelJoinRequestAction({ requestId: fakeJoinRequest.id });

      expect(result).toMatchObject({ ok: true, data: { status: "cancelled" } });
      expect(mockCancelJoinRequest).toHaveBeenCalledWith({
        requestId: fakeJoinRequest.id,
        actorId: currentUser.id,
      });
      expect(mockRevalidatePath).toHaveBeenCalledWith("/", "layout");
    });

    it("JoinError(field=form) 映射为 form 错误", async () => {
      mockGetCurrentUser.mockResolvedValue(currentUser);
      mockCancelJoinRequest.mockRejectedValue(
        new JoinError("INVALID", "加入申请不存在或已失效", "form"),
      );

      const result = await cancelJoinRequestAction({ requestId: fakeJoinRequest.id });

      expect(result).toEqual({ ok: false, errors: { form: "加入申请不存在或已失效" } });
    });
  });

  describe("resetJoinCodeAction", () => {
    it("成功：透传新入群码并刷新布局", async () => {
      mockGetCurrentUser.mockResolvedValue(currentUser);
      mockResetJoinCode.mockResolvedValue("K7M29XQ4");

      const result = await resetJoinCodeAction({ teamId: fakeJoinRequest.teamId });

      expect(result).toEqual({ ok: true, data: { joinCode: "K7M29XQ4" } });
      expect(mockResetJoinCode).toHaveBeenCalledWith({
        teamId: fakeJoinRequest.teamId,
        actorId: currentUser.id,
      });
      expect(mockRevalidatePath).toHaveBeenCalledWith("/", "layout");
    });

    it("JoinError(field=form) 映射为 form 错误", async () => {
      mockGetCurrentUser.mockResolvedValue(currentUser);
      mockResetJoinCode.mockRejectedValue(
        new JoinError("VALIDATION", "入群码生成失败，请稍后重试", "form"),
      );

      const result = await resetJoinCodeAction({ teamId: fakeJoinRequest.teamId });

      expect(result).toEqual({ ok: false, errors: { form: "入群码生成失败，请稍后重试" } });
    });

    it("TeamPermissionError 映射为通用权限文案", async () => {
      mockGetCurrentUser.mockResolvedValue(currentUser);
      mockResetJoinCode.mockRejectedValue(new TeamPermissionError("team:invite"));

      const result = await resetJoinCodeAction({ teamId: fakeJoinRequest.teamId });

      expect(result).toEqual({ ok: false, errors: { form: "没有权限执行该操作" } });
    });
  });

  describe("setJoinCodeEnabledAction", () => {
    it("成功：透传开关状态并刷新布局", async () => {
      mockGetCurrentUser.mockResolvedValue(currentUser);
      mockSetJoinCodeEnabled.mockResolvedValue(undefined);

      const result = await setJoinCodeEnabledAction({
        teamId: fakeJoinRequest.teamId,
        enabled: false,
      });

      expect(result).toEqual({ ok: true, data: { joinCodeEnabled: false } });
      expect(mockSetJoinCodeEnabled).toHaveBeenCalledWith({
        teamId: fakeJoinRequest.teamId,
        actorId: currentUser.id,
        enabled: false,
      });
      expect(mockRevalidatePath).toHaveBeenCalledWith("/", "layout");
    });

    it("TeamPermissionError 映射为通用权限文案", async () => {
      mockGetCurrentUser.mockResolvedValue(currentUser);
      mockSetJoinCodeEnabled.mockRejectedValue(new TeamPermissionError("team:invite"));

      const result = await setJoinCodeEnabledAction({
        teamId: fakeJoinRequest.teamId,
        enabled: true,
      });

      expect(result).toEqual({ ok: false, errors: { form: "没有权限执行该操作" } });
    });
  });

  it("未知异常：console.error 记录原始错误，只返回通用文案、不泄露内部信息", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mockGetCurrentUser.mockResolvedValue(currentUser);
    mockCreateJoinRequest.mockRejectedValue(new Error("database password=super-secret"));

    const result = await createJoinRequestAction({ code: "K7M29XQ4" });

    expect(result).toEqual({ ok: false, errors: { form: "提交加入申请失败，请稍后重试" } });
    expect(JSON.stringify(result)).not.toContain("super-secret");
    expect(errorSpy).toHaveBeenCalled();

    errorSpy.mockRestore();
  });
});
