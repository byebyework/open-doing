import { afterEach, describe, expect, it, vi } from "vitest";

import { getCurrentUser } from "@/features/auth/session";
import { TeamPermissionError, getMembership } from "@/features/teams/permissions";
import { getTeamBySlug } from "@/features/teams/service";
import { revalidatePath } from "next/cache";

import {
  createVirtualMemberAction,
  removeVirtualMemberAction,
  updateVirtualMemberAction,
} from "./actions";
import {
  VirtualMemberError,
  createVirtualMember,
  removeVirtualMember,
  updateVirtualMember,
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
    createVirtualMember: vi.fn(),
    updateVirtualMember: vi.fn(),
    removeVirtualMember: vi.fn(),
  };
});

const mockGetCurrentUser = vi.mocked(getCurrentUser);
const mockGetMembership = vi.mocked(getMembership);
const mockGetTeamBySlug = vi.mocked(getTeamBySlug);
const mockRevalidatePath = vi.mocked(revalidatePath);
const mockCreateVirtualMember = vi.mocked(createVirtualMember);
const mockUpdateVirtualMember = vi.mocked(updateVirtualMember);
const mockRemoveVirtualMember = vi.mocked(removeVirtualMember);

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

const virtualMember = {
  id: "vm-id",
  teamId: team.id,
  name: "写作助手",
  role: "member" as const,
  description: undefined,
  accentColor: null,
  createdAt: "2026-10-01T00:00:00.000Z",
};

describe("虚拟成员 actions", () => {
  afterEach(() => {
    vi.resetAllMocks();
  });

  it("未登录返回「请先登录」", async () => {
    mockGetCurrentUser.mockResolvedValue(null);

    const createResult = await createVirtualMemberAction({
      teamSlug: team.slug,
      name: "写作助手",
    });
    expect(createResult).toEqual({ ok: false, errors: { form: "请先登录" } });

    expect(
      await updateVirtualMemberAction({
        teamSlug: team.slug,
        virtualMemberId: virtualMember.id,
        name: "写作助手",
      }),
    ).toEqual({ ok: false, errors: { form: "请先登录" } });
    expect(
      await removeVirtualMemberAction({ teamSlug: team.slug, virtualMemberId: virtualMember.id }),
    ).toEqual({ ok: false, errors: { form: "请先登录" } });
    expect(mockGetTeamBySlug).not.toHaveBeenCalled();
  });

  it("团队不存在或非成员 → 「团队不存在或无权访问」，不调用 service", async () => {
    mockGetCurrentUser.mockResolvedValue(currentUser);
    mockGetTeamBySlug.mockResolvedValue(null);

    expect(
      await createVirtualMemberAction({ teamSlug: "missing", name: "写作助手" }),
    ).toEqual({ ok: false, errors: { form: "团队不存在或无权访问" } });

    mockGetTeamBySlug.mockResolvedValue(team);
    mockGetMembership.mockResolvedValue(null);

    expect(
      await updateVirtualMemberAction({
        teamSlug: team.slug,
        virtualMemberId: virtualMember.id,
        name: "写作助手",
      }),
    ).toEqual({ ok: false, errors: { form: "团队不存在或无权访问" } });
    expect(mockUpdateVirtualMember).not.toHaveBeenCalled();
    expect(mockCreateVirtualMember).not.toHaveBeenCalled();
  });

  it("createVirtualMemberAction：以会话用户为 actorId 调 service，成功后刷新布局", async () => {
    mockGetCurrentUser.mockResolvedValue(currentUser);
    mockGetTeamBySlug.mockResolvedValue(team);
    mockGetMembership.mockResolvedValue(membership);
    mockCreateVirtualMember.mockResolvedValue(virtualMember);

    const result = await createVirtualMemberAction({
      teamSlug: team.slug,
      name: "写作助手",
      role: "member",
      description: "负责周报",
      accentColor: "#a66b00",
    });

    expect(result).toEqual({ ok: true, data: virtualMember });
    expect(mockCreateVirtualMember).toHaveBeenCalledWith({
      teamId: team.id,
      actorId: currentUser.id,
      name: "写作助手",
      role: "member",
      description: "负责周报",
      accentColor: "#a66b00",
    });
    expect(mockRevalidatePath).toHaveBeenCalledWith("/", "layout");
  });

  it("updateVirtualMemberAction：以会话用户为 actorId 调 service，成功后刷新布局", async () => {
    mockGetCurrentUser.mockResolvedValue(currentUser);
    mockGetTeamBySlug.mockResolvedValue(team);
    mockGetMembership.mockResolvedValue(membership);
    mockUpdateVirtualMember.mockResolvedValue({ ...virtualMember, role: "admin" });

    const result = await updateVirtualMemberAction({
      teamSlug: team.slug,
      virtualMemberId: virtualMember.id,
      role: "admin",
    });

    expect(result).toEqual({ ok: true, data: { ...virtualMember, role: "admin" } });
    expect(mockUpdateVirtualMember).toHaveBeenCalledWith({
      teamId: team.id,
      virtualMemberId: virtualMember.id,
      actorId: currentUser.id,
      role: "admin",
    });
    expect(mockRevalidatePath).toHaveBeenCalledWith("/", "layout");
  });

  it("removeVirtualMemberAction：以会话用户为 actorId 调 service，成功后刷新布局", async () => {
    mockGetCurrentUser.mockResolvedValue(currentUser);
    mockGetTeamBySlug.mockResolvedValue(team);
    mockGetMembership.mockResolvedValue(membership);
    mockRemoveVirtualMember.mockResolvedValue(undefined);

    const result = await removeVirtualMemberAction({
      teamSlug: team.slug,
      virtualMemberId: virtualMember.id,
    });

    expect(result).toEqual({ ok: true, data: null });
    expect(mockRemoveVirtualMember).toHaveBeenCalledWith({
      teamId: team.id,
      virtualMemberId: virtualMember.id,
      actorId: currentUser.id,
    });
    expect(mockRevalidatePath).toHaveBeenCalledWith("/", "layout");
  });

  it("领域错误按 i18n key 映射到 name 字段（重名）", async () => {
    mockGetCurrentUser.mockResolvedValue(currentUser);
    mockGetTeamBySlug.mockResolvedValue(team);
    mockGetMembership.mockResolvedValue(membership);
    mockCreateVirtualMember.mockRejectedValue(
      new VirtualMemberError("VALIDATION", "该团队已存在同名虚拟成员", "name", {
        key: "virtualMemberNameDuplicate",
      }),
    );

    expect(
      await createVirtualMemberAction({ teamSlug: team.slug, name: "写作助手" }),
    ).toEqual({ ok: false, errors: { name: "该团队已存在同名虚拟成员" } });
    expect(mockRevalidatePath).not.toHaveBeenCalled();
  });

  it("真实团队守卫按 i18n key 映射到 form 字段（virtualTeamOnly）", async () => {
    mockGetCurrentUser.mockResolvedValue(currentUser);
    mockGetTeamBySlug.mockResolvedValue(team);
    mockGetMembership.mockResolvedValue(membership);
    mockCreateVirtualMember.mockRejectedValue(
      new VirtualMemberError("VALIDATION", "虚拟成员只能存在于虚拟团队", "form", {
        key: "virtualTeamOnly",
      }),
    );

    expect(
      await createVirtualMemberAction({ teamSlug: team.slug, name: "写作助手" }),
    ).toEqual({ ok: false, errors: { form: "虚拟成员只能添加到虚拟团队" } });
  });

  it("无权限映射为 403 语义（errors.forbidden）", async () => {
    mockGetCurrentUser.mockResolvedValue(currentUser);
    mockGetTeamBySlug.mockResolvedValue(team);
    mockGetMembership.mockResolvedValue({ ...membership, role: "member" });
    mockRemoveVirtualMember.mockRejectedValue(new TeamPermissionError("team:remove_member"));

    expect(
      await removeVirtualMemberAction({ teamSlug: team.slug, virtualMemberId: virtualMember.id }),
    ).toEqual({ ok: false, errors: { form: "没有权限执行该操作" } });
    expect(mockRevalidatePath).not.toHaveBeenCalled();
  });

  it("未知错误回退通用兜底文案，不泄露内部信息", async () => {
    mockGetCurrentUser.mockResolvedValue(currentUser);
    mockGetTeamBySlug.mockResolvedValue(team);
    mockGetMembership.mockResolvedValue(membership);
    mockCreateVirtualMember.mockRejectedValue(new Error("database exploded"));

    expect(
      await createVirtualMemberAction({ teamSlug: team.slug, name: "写作助手" }),
    ).toEqual({ ok: false, errors: { form: "添加虚拟成员失败，请稍后重试" } });
  });

  it("无 i18n 通道的领域错误回退 zh message", async () => {
    mockGetCurrentUser.mockResolvedValue(currentUser);
    mockGetTeamBySlug.mockResolvedValue(team);
    mockGetMembership.mockResolvedValue(membership);
    mockUpdateVirtualMember.mockRejectedValue(
      new VirtualMemberError("VALIDATION", "虚拟成员不存在或已移除"),
    );

    expect(
      await updateVirtualMemberAction({
        teamSlug: team.slug,
        virtualMemberId: virtualMember.id,
        name: "改名",
      }),
    ).toEqual({ ok: false, errors: { form: "虚拟成员不存在或已移除" } });
  });
});
