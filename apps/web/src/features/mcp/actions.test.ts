import { afterEach, describe, expect, it, vi } from "vitest";

import { getCurrentUser } from "@/features/auth/session";
import { TeamPermissionError, getMembership } from "@/features/teams/permissions";
import { getTeamBySlug } from "@/features/teams/service";
import { VirtualMemberError } from "@/features/teams/virtual/service";
import { revalidatePath } from "next/cache";

import { issueApiToken, revokeApiToken } from "./api-tokens";
import { issueApiTokenAction, revokeApiTokenAction } from "./actions";

/**
 * actions 层只负责 session -> slug 解析 -> service 的衔接与错误映射
 * （mock service；真实覆盖在 api-tokens.test.ts）。
 */
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

vi.mock("@/features/auth/session", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/features/auth/session")>();
  return { ...actual, getCurrentUser: vi.fn() };
});

vi.mock("@/features/teams/permissions", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/features/teams/permissions")>();
  return { ...actual, getMembership: vi.fn() };
});

vi.mock("@/features/teams/service", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/features/teams/service")>();
  return { ...actual, getTeamBySlug: vi.fn() };
});

vi.mock("./api-tokens", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./api-tokens")>();
  return {
    ...actual,
    issueApiToken: vi.fn(),
    revokeApiToken: vi.fn(),
  };
});

const mockGetCurrentUser = vi.mocked(getCurrentUser);
const mockGetMembership = vi.mocked(getMembership);
const mockGetTeamBySlug = vi.mocked(getTeamBySlug);
const mockRevalidatePath = vi.mocked(revalidatePath);
const mockIssueApiToken = vi.mocked(issueApiToken);
const mockRevokeApiToken = vi.mocked(revokeApiToken);

const currentUser = {
  id: "user-id",
  uid: "doing_x7k2m9",
  username: "admin",
  nickname: null,
  gender: null,
  email: null,
  phone: null,
  isAdmin: false,
  isDisabled: false,
  createdAt: "2026-10-01T00:00:00.000Z",
};

const team = {
  id: "team-id",
  name: "Agent Squad",
  slug: "agent-squad",
  kind: "virtual" as const,
  ownerId: "owner-id",
  createdAt: "2026-10-01T00:00:00.000Z",
};

const membership = {
  id: "membership-id",
  teamId: team.id,
  userId: currentUser.id,
  role: "admin" as const,
  joinedAt: "2026-10-01T00:00:00.000Z",
};

const virtualMemberId = "vm-id";
const issued = { token: "odm_RAWONLYONCE", tokenPrefix: "odm_R4W0" };

describe("API Token actions", () => {
  afterEach(() => {
    vi.resetAllMocks();
  });

  it("未登录返回「请先登录」", async () => {
    mockGetCurrentUser.mockResolvedValue(null);

    expect(
      await issueApiTokenAction({ teamSlug: team.slug, virtualMemberId }),
    ).toEqual({ ok: false, errors: { form: "请先登录" } });
    expect(
      await revokeApiTokenAction({ teamSlug: team.slug, virtualMemberId }),
    ).toEqual({ ok: false, errors: { form: "请先登录" } });
    expect(mockGetTeamBySlug).not.toHaveBeenCalled();
  });

  it("团队不存在或非成员 → 「团队不存在或无权访问」，不调用 service", async () => {
    mockGetCurrentUser.mockResolvedValue(currentUser);
    mockGetTeamBySlug.mockResolvedValue(null);

    expect(
      await issueApiTokenAction({ teamSlug: "missing", virtualMemberId }),
    ).toEqual({ ok: false, errors: { form: "团队不存在或无权访问" } });

    mockGetTeamBySlug.mockResolvedValue(team);
    mockGetMembership.mockResolvedValue(null);

    expect(
      await revokeApiTokenAction({ teamSlug: team.slug, virtualMemberId }),
    ).toEqual({ ok: false, errors: { form: "团队不存在或无权访问" } });
    expect(mockIssueApiToken).not.toHaveBeenCalled();
    expect(mockRevokeApiToken).not.toHaveBeenCalled();
  });

  it("issueApiTokenAction：以会话用户为 actorId 调 service，成功后刷新布局", async () => {
    mockGetCurrentUser.mockResolvedValue(currentUser);
    mockGetTeamBySlug.mockResolvedValue(team);
    mockGetMembership.mockResolvedValue(membership);
    mockIssueApiToken.mockResolvedValue(issued);

    const result = await issueApiTokenAction({
      teamSlug: team.slug,
      virtualMemberId,
    });

    expect(result).toEqual({ ok: true, data: issued });
    expect(mockIssueApiToken).toHaveBeenCalledWith({
      virtualMemberId,
      actorId: currentUser.id,
    });
    expect(mockRevalidatePath).toHaveBeenCalledWith("/", "layout");
  });

  it("revokeApiTokenAction：以会话用户为 actorId 调 service，成功后刷新布局", async () => {
    mockGetCurrentUser.mockResolvedValue(currentUser);
    mockGetTeamBySlug.mockResolvedValue(team);
    mockGetMembership.mockResolvedValue(membership);
    mockRevokeApiToken.mockResolvedValue(undefined);

    const result = await revokeApiTokenAction({
      teamSlug: team.slug,
      virtualMemberId,
    });

    expect(result).toEqual({ ok: true, data: null });
    expect(mockRevokeApiToken).toHaveBeenCalledWith({
      virtualMemberId,
      actorId: currentUser.id,
    });
    expect(mockRevalidatePath).toHaveBeenCalledWith("/", "layout");
  });

  it("领域错误按 i18n key 映射到 form 字段（virtualMemberNotFound）", async () => {
    mockGetCurrentUser.mockResolvedValue(currentUser);
    mockGetTeamBySlug.mockResolvedValue(team);
    mockGetMembership.mockResolvedValue(membership);
    mockIssueApiToken.mockRejectedValue(
      new VirtualMemberError("VALIDATION", "虚拟成员不存在或已移除", "form", {
        key: "virtualMemberNotFound",
      }),
    );

    expect(
      await issueApiTokenAction({ teamSlug: team.slug, virtualMemberId }),
    ).toEqual({ ok: false, errors: { form: "虚拟成员不存在或已移除" } });
    expect(mockRevalidatePath).not.toHaveBeenCalled();
  });

  it("真实团队守卫映射为 virtualTeamOnly 文案（form 字段）", async () => {
    mockGetCurrentUser.mockResolvedValue(currentUser);
    mockGetTeamBySlug.mockResolvedValue(team);
    mockGetMembership.mockResolvedValue(membership);
    mockRevokeApiToken.mockRejectedValue(
      new VirtualMemberError("VALIDATION", "虚拟成员只能存在于虚拟团队", "form", {
        key: "virtualTeamOnly",
      }),
    );

    expect(
      await revokeApiTokenAction({ teamSlug: team.slug, virtualMemberId }),
    ).toEqual({ ok: false, errors: { form: "虚拟成员只能添加到虚拟团队" } });
  });

  it("无权限映射为 403 语义（errors.forbidden）", async () => {
    mockGetCurrentUser.mockResolvedValue(currentUser);
    mockGetTeamBySlug.mockResolvedValue(team);
    mockGetMembership.mockResolvedValue({ ...membership, role: "member" });
    mockIssueApiToken.mockRejectedValue(new TeamPermissionError("team:remove_member"));

    expect(
      await issueApiTokenAction({ teamSlug: team.slug, virtualMemberId }),
    ).toEqual({ ok: false, errors: { form: "没有权限执行该操作" } });
    expect(mockRevalidatePath).not.toHaveBeenCalled();
  });

  it("未知错误回退通用兜底文案，不泄露内部信息", async () => {
    mockGetCurrentUser.mockResolvedValue(currentUser);
    mockGetTeamBySlug.mockResolvedValue(team);
    mockGetMembership.mockResolvedValue(membership);
    mockIssueApiToken.mockRejectedValue(new Error("database exploded"));

    expect(
      await issueApiTokenAction({ teamSlug: team.slug, virtualMemberId }),
    ).toEqual({ ok: false, errors: { form: "签发 API Token 失败，请稍后重试" } });

    mockRevokeApiToken.mockRejectedValue(new Error("database exploded"));
    expect(
      await revokeApiTokenAction({ teamSlug: team.slug, virtualMemberId }),
    ).toEqual({ ok: false, errors: { form: "吊销 API Token 失败，请稍后重试" } });
  });

  it("无 i18n 通道的领域错误回退 zh message", async () => {
    mockGetCurrentUser.mockResolvedValue(currentUser);
    mockGetTeamBySlug.mockResolvedValue(team);
    mockGetMembership.mockResolvedValue(membership);
    mockRevokeApiToken.mockRejectedValue(
      new VirtualMemberError("VALIDATION", "虚拟成员不存在或已移除"),
    );

    expect(
      await revokeApiTokenAction({ teamSlug: team.slug, virtualMemberId }),
    ).toEqual({ ok: false, errors: { form: "虚拟成员不存在或已移除" } });
  });
});
