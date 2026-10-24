import { afterEach, describe, expect, it, vi } from "vitest";

import { getCurrentUser } from "@/features/auth/session";
import { TeamPermissionError, getMembership } from "@/features/teams/permissions";
import { getTeamBySlug } from "@/features/teams/service";
import { revalidatePath } from "next/cache";

import {
  dissolveTeamAction,
  leaveTeamAction,
  removeMemberAction,
  transferTeamAction,
} from "./actions";
import {
  GovernanceError,
  MemberError,
  dissolveTeam,
  leaveTeam,
  removeMember,
  transferTeam,
} from "./service";

/**
 * actions 层只负责 session -> slug 解析 -> service 的衔接与错误映射
 * （mock service；真实覆盖在 service.test.ts）。
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

vi.mock("./service", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./service")>();
  return {
    ...actual,
    removeMember: vi.fn(),
    leaveTeam: vi.fn(),
    transferTeam: vi.fn(),
    dissolveTeam: vi.fn(),
  };
});

const mockGetCurrentUser = vi.mocked(getCurrentUser);
const mockGetMembership = vi.mocked(getMembership);
const mockGetTeamBySlug = vi.mocked(getTeamBySlug);
const mockRevalidatePath = vi.mocked(revalidatePath);
const mockRemoveMember = vi.mocked(removeMember);
const mockLeaveTeam = vi.mocked(leaveTeam);
const mockTransferTeam = vi.mocked(transferTeam);
const mockDissolveTeam = vi.mocked(dissolveTeam);

const currentUser = {
  id: "user-id",
  uid: "doing_x7k2m9",
  username: "admin",
  createdAt: "2026-10-01T00:00:00.000Z",
};

const team = {
  id: "team-id",
  name: "增长突击队",
  slug: "growth-squad",
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

describe("成员移除 / 主动退出 actions", () => {
  afterEach(() => {
    vi.resetAllMocks();
  });

  it("未登录返回「请先登录」", async () => {
    mockGetCurrentUser.mockResolvedValue(null);

    expect(
      await removeMemberAction({ teamSlug: team.slug, targetUserId: "member-id" }),
    ).toEqual({ ok: false, errors: { form: "请先登录" } });
    expect(await leaveTeamAction({ teamSlug: team.slug })).toEqual({
      ok: false,
      errors: { form: "请先登录" },
    });
    expect(mockGetTeamBySlug).not.toHaveBeenCalled();
  });

  it("团队不存在 → 「团队不存在或无权访问」", async () => {
    mockGetCurrentUser.mockResolvedValue(currentUser);
    mockGetTeamBySlug.mockResolvedValue(null);

    expect(
      await removeMemberAction({ teamSlug: "missing", targetUserId: "member-id" }),
    ).toEqual({ ok: false, errors: { form: "团队不存在或无权访问" } });
  });

  it("非成员 → 「团队不存在或无权访问」", async () => {
    mockGetCurrentUser.mockResolvedValue(currentUser);
    mockGetTeamBySlug.mockResolvedValue(team);
    mockGetMembership.mockResolvedValue(null);

    expect(await leaveTeamAction({ teamSlug: team.slug })).toEqual({
      ok: false,
      errors: { form: "团队不存在或无权访问" },
    });
    expect(mockLeaveTeam).not.toHaveBeenCalled();
  });

  it("removeMemberAction：以会话用户为 actorId 调 service，成功后刷新布局", async () => {
    mockGetCurrentUser.mockResolvedValue(currentUser);
    mockGetTeamBySlug.mockResolvedValue(team);
    mockGetMembership.mockResolvedValue(membership);
    mockRemoveMember.mockResolvedValue(undefined);

    const result = await removeMemberAction({
      teamSlug: team.slug,
      targetUserId: "member-id",
    });

    expect(result).toEqual({ ok: true, data: null });
    expect(mockRemoveMember).toHaveBeenCalledWith({
      teamId: team.id,
      targetUserId: "member-id",
      actorId: currentUser.id,
    });
    expect(mockRevalidatePath).toHaveBeenCalledWith("/", "layout");
  });

  it("leaveTeamAction：以会话用户为 actorId 调 service，成功后刷新布局", async () => {
    mockGetCurrentUser.mockResolvedValue(currentUser);
    mockGetTeamBySlug.mockResolvedValue(team);
    mockGetMembership.mockResolvedValue(membership);
    mockLeaveTeam.mockResolvedValue(undefined);

    const result = await leaveTeamAction({ teamSlug: team.slug });

    expect(result).toEqual({ ok: true, data: null });
    expect(mockLeaveTeam).toHaveBeenCalledWith({ teamId: team.id, actorId: currentUser.id });
    expect(mockRevalidatePath).toHaveBeenCalledWith("/", "layout");
  });

  it("权限错误映射为 form 错误（使用错误文案）", async () => {
    mockGetCurrentUser.mockResolvedValue(currentUser);
    mockGetTeamBySlug.mockResolvedValue(team);
    mockGetMembership.mockResolvedValue(membership);
    mockRemoveMember.mockRejectedValue(new TeamPermissionError("team:remove_member"));

    expect(
      await removeMemberAction({ teamSlug: team.slug, targetUserId: "owner-id" }),
    ).toEqual({ ok: false, errors: { form: "没有权限执行该操作" } });
    expect(mockRevalidatePath).not.toHaveBeenCalled();
  });

  it("owner 退出的策略错误文案原样透出", async () => {
    mockGetCurrentUser.mockResolvedValue(currentUser);
    mockGetTeamBySlug.mockResolvedValue(team);
    mockGetMembership.mockResolvedValue({ ...membership, role: "owner" });
    const policyError = new TeamPermissionError("team:leave");
    policyError.message = "请先转让团队或解散团队";
    mockLeaveTeam.mockRejectedValue(policyError);

    expect(await leaveTeamAction({ teamSlug: team.slug })).toEqual({
      ok: false,
      errors: { form: "请先转让团队或解散团队" },
    });
    expect(mockRevalidatePath).not.toHaveBeenCalled();
  });

  it("领域错误映射为 form 错误", async () => {
    mockGetCurrentUser.mockResolvedValue(currentUser);
    mockGetTeamBySlug.mockResolvedValue(team);
    mockGetMembership.mockResolvedValue(membership);
    mockRemoveMember.mockRejectedValue(new MemberError("NOT_FOUND", "成员不存在或已退出"));

    expect(
      await removeMemberAction({ teamSlug: team.slug, targetUserId: "gone-id" }),
    ).toEqual({ ok: false, errors: { form: "成员不存在或已退出" } });
  });

  it("transfer / dissolve 未登录返回「请先登录」", async () => {
    mockGetCurrentUser.mockResolvedValue(null);

    expect(
      await transferTeamAction({ teamSlug: team.slug, targetUserId: "admin-id" }),
    ).toEqual({ ok: false, errors: { form: "请先登录" } });
    expect(await dissolveTeamAction({ teamSlug: team.slug })).toEqual({
      ok: false,
      errors: { form: "请先登录" },
    });
    expect(mockGetTeamBySlug).not.toHaveBeenCalled();
  });

  it("transfer / dissolve 团队不存在或非成员 → 「团队不存在或无权访问」", async () => {
    mockGetCurrentUser.mockResolvedValue(currentUser);
    mockGetTeamBySlug.mockResolvedValue(null);

    expect(
      await transferTeamAction({ teamSlug: "missing", targetUserId: "admin-id" }),
    ).toEqual({ ok: false, errors: { form: "团队不存在或无权访问" } });
    expect(await dissolveTeamAction({ teamSlug: "missing" })).toEqual({
      ok: false,
      errors: { form: "团队不存在或无权访问" },
    });

    mockGetTeamBySlug.mockResolvedValue(team);
    mockGetMembership.mockResolvedValue(null);

    expect(await dissolveTeamAction({ teamSlug: team.slug })).toEqual({
      ok: false,
      errors: { form: "团队不存在或无权访问" },
    });
    expect(mockDissolveTeam).not.toHaveBeenCalled();
  });

  it("transferTeamAction：以会话用户为 actorId 调 service，成功后刷新布局", async () => {
    mockGetCurrentUser.mockResolvedValue(currentUser);
    mockGetTeamBySlug.mockResolvedValue(team);
    mockGetMembership.mockResolvedValue({ ...membership, role: "owner" });
    mockTransferTeam.mockResolvedValue(undefined);

    const result = await transferTeamAction({
      teamSlug: team.slug,
      targetUserId: "admin-id",
    });

    expect(result).toEqual({ ok: true, data: null });
    expect(mockTransferTeam).toHaveBeenCalledWith({
      teamId: team.id,
      targetUserId: "admin-id",
      actorId: currentUser.id,
    });
    expect(mockRevalidatePath).toHaveBeenCalledWith("/", "layout");
  });

  it("dissolveTeamAction：以会话用户为 actorId 调 service，只返回 ok（redirect 由 UI 处理）", async () => {
    mockGetCurrentUser.mockResolvedValue(currentUser);
    mockGetTeamBySlug.mockResolvedValue(team);
    mockGetMembership.mockResolvedValue({ ...membership, role: "owner" });
    mockDissolveTeam.mockResolvedValue(undefined);

    const result = await dissolveTeamAction({ teamSlug: team.slug });

    expect(result).toEqual({ ok: true, data: null });
    expect(mockDissolveTeam).toHaveBeenCalledWith({ teamId: team.id, actorId: currentUser.id });
    expect(mockRevalidatePath).toHaveBeenCalledWith("/", "layout");
  });

  it("transfer / dissolve 权限错误映射为 form 错误", async () => {
    mockGetCurrentUser.mockResolvedValue(currentUser);
    mockGetTeamBySlug.mockResolvedValue(team);
    mockGetMembership.mockResolvedValue(membership);
    mockTransferTeam.mockRejectedValue(new TeamPermissionError("team:transfer"));
    mockDissolveTeam.mockRejectedValue(new TeamPermissionError("team:dissolve"));

    expect(
      await transferTeamAction({ teamSlug: team.slug, targetUserId: "admin-id" }),
    ).toEqual({ ok: false, errors: { form: "没有权限执行该操作" } });
    expect(await dissolveTeamAction({ teamSlug: team.slug })).toEqual({
      ok: false,
      errors: { form: "没有权限执行该操作" },
    });
    expect(mockRevalidatePath).not.toHaveBeenCalled();
  });

  it("转让 / 解散领域错误映射为 form 错误", async () => {
    mockGetCurrentUser.mockResolvedValue(currentUser);
    mockGetTeamBySlug.mockResolvedValue(team);
    mockGetMembership.mockResolvedValue({ ...membership, role: "owner" });
    mockTransferTeam.mockRejectedValue(
      new GovernanceError("TARGET_NOT_MEMBER", "目标用户不是团队成员"),
    );
    mockDissolveTeam.mockRejectedValue(new GovernanceError("TEAM_NOT_FOUND", "团队不存在"));

    expect(
      await transferTeamAction({ teamSlug: team.slug, targetUserId: "outsider-id" }),
    ).toEqual({ ok: false, errors: { form: "目标用户不是团队成员" } });
    expect(await dissolveTeamAction({ teamSlug: team.slug })).toEqual({
      ok: false,
      errors: { form: "团队不存在" },
    });
    expect(mockRevalidatePath).not.toHaveBeenCalled();
  });
});
