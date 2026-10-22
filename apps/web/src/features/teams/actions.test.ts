import { afterEach, describe, expect, it, vi } from "vitest";

import { getCurrentUser } from "@/features/auth/session";
import type { Team } from "@open-doing/types";

import { createTeamAction } from "./actions";
import { TeamError, createTeam } from "./service";

/**
 * actions 层只负责 session -> actorId -> service 的衔接与错误映射。
 * Server Action 的默认 DB client 在模块作用域解析，无法在测试里
 * 指向测试库，因此 mock service；service 的真实数据库覆盖在
 * service.test.ts。
 */
vi.mock("@/features/auth/session", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/features/auth/session")>();
  return { ...actual, getCurrentUser: vi.fn() };
});

vi.mock("./service", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./service")>();
  return { ...actual, createTeam: vi.fn() };
});

const mockGetCurrentUser = vi.mocked(getCurrentUser);
const mockCreateTeam = vi.mocked(createTeam);

const fakeTeam: Team = {
  id: "00000000-0000-0000-0000-000000000001",
  name: "增长突击队",
  slug: "team",
  ownerId: "00000000-0000-0000-0000-000000000002",
  createdAt: "2026-10-23T00:00:00.000Z",
};

describe("团队 actions", () => {
  afterEach(() => {
    vi.resetAllMocks();
  });

  it("未登录：返回 form 错误「请先登录」，且不触达 service", async () => {
    mockGetCurrentUser.mockResolvedValue(null);

    const result = await createTeamAction({ name: "增长突击队" });

    expect(result).toEqual({ ok: false, errors: { form: "请先登录" } });
    expect(mockCreateTeam).not.toHaveBeenCalled();
  });

  it("已登录：以当前用户为 actorId 调 service，返回 ok:true 与 Team", async () => {
    mockGetCurrentUser.mockResolvedValue({
      id: fakeTeam.ownerId,
      uid: "doing_x7k2m9",
      username: "alice",
      createdAt: "2026-10-01T00:00:00.000Z",
    });
    mockCreateTeam.mockResolvedValue(fakeTeam);

    const result = await createTeamAction({ name: "增长突击队" });

    expect(result).toEqual({ ok: true, data: fakeTeam });
    expect(mockCreateTeam).toHaveBeenCalledWith({ name: "增长突击队" }, fakeTeam.ownerId);
  });

  it("名称非法：TeamError 映射为 name 字段错误", async () => {
    mockGetCurrentUser.mockResolvedValue({
      id: fakeTeam.ownerId,
      uid: "doing_x7k2m9",
      username: "alice",
      createdAt: "2026-10-01T00:00:00.000Z",
    });
    mockCreateTeam.mockRejectedValue(new TeamError("VALIDATION", "团队名称需为 2–30 个字符", "name"));

    const result = await createTeamAction({ name: "团" });

    expect(result).toEqual({ ok: false, errors: { name: "团队名称需为 2–30 个字符" } });
  });
});
