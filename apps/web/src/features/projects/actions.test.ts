import type { Project } from "@open-doing/types";
import { afterEach, describe, expect, it, vi } from "vitest";

import { getCurrentUser } from "@/features/auth/session";
import { TeamPermissionError } from "@/features/teams/permissions";
import { DomainError } from "@/lib/domain-error";

import {
  createTeamProjectAction,
  deleteTeamProjectAction,
  updateTeamProjectAction,
} from "./actions";
import {
  createTeamProject,
  deleteTeamProject,
  updateTeamProject,
} from "./service";

/**
 * actions 层只负责 session -> actorId -> service 的衔接与错误映射；
 * 服务层行为在 service.test.ts 覆盖，这里 mock 掉。
 */
vi.mock("@/features/auth/session", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/features/auth/session")>();
  return { ...actual, getCurrentUser: vi.fn() };
});

vi.mock("./service", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./service")>();
  return {
    ...actual,
    createTeamProject: vi.fn(),
    updateTeamProject: vi.fn(),
    deleteTeamProject: vi.fn(),
  };
});

const mockGetCurrentUser = vi.mocked(getCurrentUser);
const mockCreate = vi.mocked(createTeamProject);
const mockUpdate = vi.mocked(updateTeamProject);
const mockDelete = vi.mocked(deleteTeamProject);

const TEAM_ID = "00000000-0000-0000-0000-000000000002";

const fakeProject: Project = {
  id: "00000000-0000-0000-0000-000000000001",
  teamId: TEAM_ID,
  ownerId: null,
  name: "Website Revamp",
  slug: "website-revamp",
  description: undefined,
  createdAt: "2026-10-23T00:00:00.000Z",
};

describe("团队项目 actions", () => {
  afterEach(() => {
    vi.resetAllMocks();
  });

  it("未登录：返回 form 错误「请先登录」，且不触达 service", async () => {
    mockGetCurrentUser.mockResolvedValue(null);

    await expect(
      createTeamProjectAction({ teamId: TEAM_ID, name: "X" }),
    ).resolves.toEqual({ ok: false, errors: { form: "请先登录" } });
    await expect(
      updateTeamProjectAction({ teamId: TEAM_ID, projectId: fakeProject.id, name: "X" }),
    ).resolves.toEqual({ ok: false, errors: { form: "请先登录" } });
    await expect(
      deleteTeamProjectAction({ teamId: TEAM_ID, projectId: fakeProject.id }),
    ).resolves.toEqual({ ok: false, errors: { form: "请先登录" } });

    expect(mockCreate).not.toHaveBeenCalled();
    expect(mockUpdate).not.toHaveBeenCalled();
    expect(mockDelete).not.toHaveBeenCalled();
  });

  it("权限错误：映射为 form「没有权限执行该操作」", async () => {
    mockGetCurrentUser.mockResolvedValue({ id: "u1", uid: "doing_x", username: "alice", createdAt: "" });
    mockCreate.mockRejectedValue(new TeamPermissionError("team:manage_projects"));

    await expect(
      createTeamProjectAction({ teamId: TEAM_ID, name: "X" }),
    ).resolves.toEqual({ ok: false, errors: { form: "没有权限执行该操作" } });
  });

  it("领域错误：按字段映射", async () => {
    mockGetCurrentUser.mockResolvedValue({ id: "u1", uid: "doing_x", username: "alice", createdAt: "" });
    mockCreate.mockRejectedValue(new DomainError("请输入项目名称", "name"));

    await expect(
      createTeamProjectAction({ teamId: TEAM_ID, name: "" }),
    ).resolves.toEqual({ ok: false, errors: { name: "请输入项目名称" } });
  });

  it("未知异常：只返回通用文案", async () => {
    mockGetCurrentUser.mockResolvedValue({ id: "u1", uid: "doing_x", username: "alice", createdAt: "" });
    mockDelete.mockRejectedValue(new Error("boom"));

    await expect(
      deleteTeamProjectAction({ teamId: TEAM_ID, projectId: fakeProject.id }),
    ).resolves.toEqual({ ok: false, errors: { form: "操作失败，请稍后重试" } });
  });

  it("成功：返回 ok 与数据", async () => {
    mockGetCurrentUser.mockResolvedValue({ id: "u1", uid: "doing_x", username: "alice", createdAt: "" });
    mockCreate.mockResolvedValue(fakeProject);
    mockUpdate.mockResolvedValue(fakeProject);
    mockDelete.mockResolvedValue(undefined);

    await expect(
      createTeamProjectAction({ teamId: TEAM_ID, name: "Website Revamp" }),
    ).resolves.toEqual({ ok: true, data: fakeProject });
    await expect(
      updateTeamProjectAction({ teamId: TEAM_ID, projectId: fakeProject.id, name: "New" }),
    ).resolves.toEqual({ ok: true, data: fakeProject });
    await expect(
      deleteTeamProjectAction({ teamId: TEAM_ID, projectId: fakeProject.id }),
    ).resolves.toEqual({ ok: true, data: true });

    expect(mockCreate).toHaveBeenCalledWith(
      { teamId: TEAM_ID, actorId: "u1", name: "Website Revamp" },
    );
    expect(mockDelete).toHaveBeenCalledWith({
      teamId: TEAM_ID,
      projectId: fakeProject.id,
      actorId: "u1",
    });
  });
});
