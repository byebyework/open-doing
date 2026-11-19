import type { Tag } from "@open-doing/types";
import { afterEach, describe, expect, it, vi } from "vitest";

import { getCurrentUser } from "@/features/auth/session";
import { TeamPermissionError } from "@/features/teams/permissions";
import { DomainError } from "@/lib/domain-error";

import {
  createTagAction,
  deleteTagAction,
  updateTagAction,
} from "./actions";
import { createTag, deleteTag, updateTag } from "./service";

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
    createTag: vi.fn(),
    updateTag: vi.fn(),
    deleteTag: vi.fn(),
  };
});

const mockGetCurrentUser = vi.mocked(getCurrentUser);
const mockCreate = vi.mocked(createTag);
const mockUpdate = vi.mocked(updateTag);
const mockDelete = vi.mocked(deleteTag);

const TEAM_ID = "00000000-0000-0000-0000-000000000002";

const fakeTag: Tag = {
  id: "00000000-0000-0000-0000-000000000001",
  teamId: TEAM_ID,
  ownerId: null,
  name: "Research",
  color: "purple",
  createdAt: "2026-11-19T00:00:00.000Z",
};

describe("标签 actions", () => {
  afterEach(() => {
    vi.resetAllMocks();
  });

  it("未登录：返回 form 级错误，且不触达 service", async () => {
    mockGetCurrentUser.mockResolvedValue(null);

    const [created, updated, deleted] = await Promise.all([
      createTagAction({ teamId: TEAM_ID, name: "X", color: "mint" }),
      updateTagAction({ teamId: TEAM_ID, tagId: fakeTag.id, name: "Y" }),
      deleteTagAction({ teamId: TEAM_ID, tagId: fakeTag.id }),
    ]);

    expect(created.ok).toBe(false);
    expect(updated.ok).toBe(false);
    expect(deleted.ok).toBe(false);
    expect(created.errors.form).toBeTruthy();
    expect(mockCreate).not.toHaveBeenCalled();
    expect(mockUpdate).not.toHaveBeenCalled();
    expect(mockDelete).not.toHaveBeenCalled();
  });

  it("登录成功：actorId 取会话用户，透传 service 结果", async () => {
    mockGetCurrentUser.mockResolvedValue({ id: "u1" } as never);
    mockCreate.mockResolvedValue(fakeTag);
    mockUpdate.mockResolvedValue({ ...fakeTag, name: "Renamed" });
    mockDelete.mockResolvedValue(undefined);

    await expect(
      createTagAction({ teamId: TEAM_ID, name: "Research", color: "purple" }),
    ).resolves.toEqual({ ok: true, data: fakeTag });
    expect(mockCreate).toHaveBeenCalledWith({
      teamId: TEAM_ID,
      actorId: "u1",
      name: "Research",
      color: "purple",
    });

    await expect(
      updateTagAction({ teamId: TEAM_ID, tagId: fakeTag.id, name: "Renamed" }),
    ).resolves.toEqual({ ok: true, data: { ...fakeTag, name: "Renamed" } });
    expect(mockUpdate).toHaveBeenCalledWith({
      teamId: TEAM_ID,
      actorId: "u1",
      tagId: fakeTag.id,
      name: "Renamed",
    });

    await expect(deleteTagAction({ teamId: TEAM_ID, tagId: fakeTag.id })).resolves.toEqual({
      ok: true,
      data: true,
    });
    expect(mockDelete).toHaveBeenCalledWith({
      teamId: TEAM_ID,
      actorId: "u1",
      tagId: fakeTag.id,
    });
  });

  it("个人空间：不传 teamId 即 ownerId = 会话用户", async () => {
    mockGetCurrentUser.mockResolvedValue({ id: "u1" } as never);
    mockCreate.mockResolvedValue({ ...fakeTag, teamId: null, ownerId: "u1" });

    await expect(
      createTagAction({ name: "Personal", color: "tangerine" }),
    ).resolves.toMatchObject({ ok: true });
    expect(mockCreate).toHaveBeenCalledWith({
      ownerId: "u1",
      actorId: "u1",
      name: "Personal",
      color: "tangerine",
    });
  });

  it("DomainError：按 field 映射并走 tags 域 i18n key", async () => {
    mockGetCurrentUser.mockResolvedValue({ id: "u1" } as never);
    mockCreate.mockRejectedValue(
      new DomainError("duplicate", "name", { key: "tagNameDuplicate" }),
    );

    const result = await createTagAction({ teamId: TEAM_ID, name: "Dup", color: "mint" });
    expect(result.ok).toBe(false);
    expect(result.errors.name).toBeTruthy();
  });

  it("无 field 的 DomainError：映射到 form", async () => {
    mockGetCurrentUser.mockResolvedValue({ id: "u1" } as never);
    mockDelete.mockRejectedValue(
      new DomainError("not found", undefined, { key: "tagNotFound" }),
    );

    const result = await deleteTagAction({ teamId: TEAM_ID, tagId: fakeTag.id });
    expect(result.ok).toBe(false);
    expect(result.errors.form).toBeTruthy();
  });

  it("权限错误：映射为表单级 403 文案", async () => {
    mockGetCurrentUser.mockResolvedValue({ id: "u1" } as never);
    mockCreate.mockRejectedValue(new TeamPermissionError("team:manage_projects"));

    const result = await createTagAction({ teamId: TEAM_ID, name: "Nope", color: "mint" });
    expect(result.ok).toBe(false);
    expect(result.errors.form).toBeTruthy();
  });
});
