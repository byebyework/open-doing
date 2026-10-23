import { afterEach, describe, expect, it, vi } from "vitest";

import { getCurrentUser } from "@/features/auth/session";
import { TeamPermissionError } from "@/features/teams/permissions";
import type { TeamInvite } from "@open-doing/types";

import { createInviteAction, rescindInviteAction, respondToInviteAction } from "./actions";
import { InviteError, createInvite, rescindInvite, respondToInvite } from "./service";

/**
 * actions 层只负责 session -> actorId -> service 的衔接与错误映射
 * （mock service；service 真实覆盖在 service.test.ts）。
 */
vi.mock("@/features/auth/session", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/features/auth/session")>();
  return { ...actual, getCurrentUser: vi.fn() };
});

vi.mock("./service", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./service")>();
  return { ...actual, createInvite: vi.fn(), rescindInvite: vi.fn(), respondToInvite: vi.fn() };
});

const mockGetCurrentUser = vi.mocked(getCurrentUser);
const mockCreateInvite = vi.mocked(createInvite);
const mockRescindInvite = vi.mocked(rescindInvite);
const mockRespondToInvite = vi.mocked(respondToInvite);

const fakeInvite: TeamInvite = {
  id: "00000000-0000-0000-0000-000000000003",
  teamId: "00000000-0000-0000-0000-000000000001",
  inviteeId: "00000000-0000-0000-0000-000000000002",
  invitedById: "00000000-0000-0000-0000-000000000004",
  status: "pending",
  createdAt: "2026-10-23T00:00:00.000Z",
};

describe("邀请 actions", () => {
  afterEach(() => {
    vi.resetAllMocks();
  });

  it("createInviteAction：未登录返回「请先登录」", async () => {
    mockGetCurrentUser.mockResolvedValue(null);

    expect(await createInviteAction({ teamId: "t", actorId: "", uid: "doing_x7k2m9" })).toEqual({
      ok: false,
      errors: { form: "请先登录" },
    });
  });

  it("createInviteAction：member 直调被拒（权限错误映射为 form 错误）", async () => {
    mockGetCurrentUser.mockResolvedValue({
      id: "member-id",
      uid: "doing_2vbd81",
      username: "member",
      createdAt: "2026-10-01T00:00:00.000Z",
    });
    mockCreateInvite.mockRejectedValue(new TeamPermissionError("team:invite"));

    const result = await createInviteAction({ teamId: "t", actorId: "", uid: "doing_9ar45e" });

    expect(result).toEqual({ ok: false, errors: { form: "没有权限执行该操作" } });
  });

  it("createInviteAction：UID 无效映射为 uid 字段错误", async () => {
    mockGetCurrentUser.mockResolvedValue({
      id: "owner-id",
      uid: "doing_x7k2m9",
      username: "owner",
      createdAt: "2026-10-01T00:00:00.000Z",
    });
    mockCreateInvite.mockRejectedValue(new InviteError("UID_NOT_FOUND", "UID 无效", "uid"));

    const result = await createInviteAction({ teamId: "t", actorId: "", uid: "doing_zzzzzz" });

    expect(result).toEqual({ ok: false, errors: { uid: "UID 无效" } });
  });

  it("createInviteAction：成功路径以会话用户为 actorId 调 service", async () => {
    mockGetCurrentUser.mockResolvedValue({
      id: "owner-id",
      uid: "doing_x7k2m9",
      username: "owner",
      createdAt: "2026-10-01T00:00:00.000Z",
    });
    mockCreateInvite.mockResolvedValue(fakeInvite);

    const result = await createInviteAction({ teamId: "t", actorId: "", uid: "doing_9ar45e" });

    expect(result).toEqual({ ok: true, data: fakeInvite });
    expect(mockCreateInvite).toHaveBeenCalledWith(
      { teamId: "t", actorId: "owner-id", uid: "doing_9ar45e" },
    );
  });

  it("rescindInviteAction：以会话用户为 actorId 调 service", async () => {
    mockGetCurrentUser.mockResolvedValue({
      id: "owner-id",
      uid: "doing_x7k2m9",
      username: "owner",
      createdAt: "2026-10-01T00:00:00.000Z",
    });
    mockRescindInvite.mockResolvedValue({ ...fakeInvite, status: "rescinded" });

    const result = await rescindInviteAction({ inviteId: fakeInvite.id, teamId: fakeInvite.teamId });

    expect(result).toMatchObject({ ok: true, data: { status: "rescinded" } });
    expect(mockRescindInvite).toHaveBeenCalledWith({
      inviteId: fakeInvite.id,
      teamId: fakeInvite.teamId,
      actorId: "owner-id",
    });
  });

  it("respondToInviteAction：以会话用户为 actorId 调 service", async () => {
    mockGetCurrentUser.mockResolvedValue({
      id: "invitee-id",
      uid: "doing_9ar45e",
      username: "invitee",
      createdAt: "2026-10-01T00:00:00.000Z",
    });
    mockRespondToInvite.mockResolvedValue({
      id: "team-id",
      name: "效率工程部",
      slug: "team",
      ownerId: "owner-id",
      createdAt: "2026-10-01T00:00:00.000Z",
    });

    const result = await respondToInviteAction({ inviteId: fakeInvite.id, accept: true });

    expect(result).toMatchObject({ ok: true, data: { id: "team-id" } });
    expect(mockRespondToInvite).toHaveBeenCalledWith({
      inviteId: fakeInvite.id,
      actorId: "invitee-id",
      accept: true,
    });
  });

  it("respondToInviteAction：失效邀请返回友好的 form 错误（不 500）", async () => {
    mockGetCurrentUser.mockResolvedValue({
      id: "invitee-id",
      uid: "doing_9ar45e",
      username: "invitee",
      createdAt: "2026-10-01T00:00:00.000Z",
    });
    mockRespondToInvite.mockRejectedValue(new InviteError("INVALID", "邀请不存在或已失效", "form"));

    const result = await respondToInviteAction({ inviteId: fakeInvite.id, accept: true });

    expect(result).toEqual({ ok: false, errors: { form: "邀请不存在或已失效" } });
  });
});
