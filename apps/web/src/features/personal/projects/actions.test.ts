import type { Project, ProjectMilestone } from "@open-doing/types";
import { afterEach, describe, expect, it, vi } from "vitest";

import { requireUser } from "@/features/auth/session";
import { DomainError } from "@/lib/domain-error";

import {
  addPersonalProjectMilestoneAction,
  createPersonalProjectAction,
  deletePersonalProjectAction,
  deletePersonalProjectMilestoneAction,
  listPersonalProjectMilestonesAction,
  updatePersonalProjectAction,
  updatePersonalProjectMilestoneAction,
} from "./actions";
import {
  addPersonalProjectMilestone,
  createPersonalProject,
  deletePersonalProject,
  deletePersonalProjectMilestone,
  listPersonalProjectMilestones,
  updatePersonalProject,
  updatePersonalProjectMilestone,
} from "./service";

/**
 * actions 层只负责 requireUser -> userId -> service 的衔接与错误映射；
 * 服务层行为在 service.test.ts 覆盖，这里 mock 掉。
 */
vi.mock("@/features/auth/session", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/features/auth/session")>();
  return { ...actual, requireUser: vi.fn() };
});

vi.mock("./service", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./service")>();
  return {
    ...actual,
    createPersonalProject: vi.fn(),
    updatePersonalProject: vi.fn(),
    deletePersonalProject: vi.fn(),
    addPersonalProjectMilestone: vi.fn(),
    deletePersonalProjectMilestone: vi.fn(),
    listPersonalProjectMilestones: vi.fn(),
    updatePersonalProjectMilestone: vi.fn(),
  };
});

const mockRequireUser = vi.mocked(requireUser);
const mockCreate = vi.mocked(createPersonalProject);
const mockUpdate = vi.mocked(updatePersonalProject);
const mockDelete = vi.mocked(deletePersonalProject);
const mockAddMilestone = vi.mocked(addPersonalProjectMilestone);
const mockDeleteMilestone = vi.mocked(deletePersonalProjectMilestone);
const mockListMilestones = vi.mocked(listPersonalProjectMilestones);
const mockUpdateMilestone = vi.mocked(updatePersonalProjectMilestone);

const PROJECT_ID = "00000000-0000-0000-0000-000000000001";

const fakeProject: Project = {
  id: PROJECT_ID,
  teamId: null,
  ownerId: "u1",
  name: "Learning",
  slug: "learning",
  priority: "medium",
  status: "backlog",
  leadId: null,
  createdAt: "2026-11-20T00:00:00.000Z",
};

const fakeMilestone: ProjectMilestone = {
  id: "00000000-0000-0000-0000-000000000003",
  projectId: PROJECT_ID,
  name: "上线",
  dueDate: "2026-12-20",
  createdAt: "2026-11-20T00:00:00.000Z",
};

describe("个人项目 actions", () => {
  afterEach(() => {
    vi.resetAllMocks();
  });

  it("创建/更新把 priority 与 milestones 透传给 service", async () => {
    mockRequireUser.mockResolvedValue({ id: "u1" } as never);
    mockCreate.mockResolvedValue(fakeProject);
    mockUpdate.mockResolvedValue(fakeProject);

    await createPersonalProjectAction({
      name: "X",
      priority: "high",
      milestones: [{ name: "上线", dueDate: "2026-12-20" }],
    });
    expect(mockCreate).toHaveBeenCalledWith("u1", {
      name: "X",
      priority: "high",
      milestones: [{ name: "上线", dueDate: "2026-12-20" }],
    });

    await updatePersonalProjectAction(PROJECT_ID, { priority: "low" });
    expect(mockUpdate).toHaveBeenCalledWith("u1", PROJECT_ID, { priority: "low" });
  });

  it("addPersonalProjectMilestoneAction：透传 + 权限外泄兜底", async () => {
    mockRequireUser.mockResolvedValue({ id: "u1" } as never);
    mockAddMilestone.mockResolvedValue(fakeMilestone);

    await expect(
      addPersonalProjectMilestoneAction(PROJECT_ID, {
        name: "上线",
        description: "发布",
        dueDate: "2026-12-20",
      }),
    ).resolves.toEqual({ ok: true, data: fakeMilestone });
    expect(mockAddMilestone).toHaveBeenCalledWith("u1", PROJECT_ID, {
      name: "上线",
      description: "发布",
      dueDate: "2026-12-20",
    });

    mockAddMilestone.mockRejectedValue(new DomainError("项目不存在或无权访问"));
    await expect(
      addPersonalProjectMilestoneAction(PROJECT_ID, { name: "X" }),
    ).resolves.toEqual({ ok: false, errors: { form: "项目不存在或无权访问" } });
  });

  it("deletePersonalProjectMilestoneAction：透传", async () => {
    mockRequireUser.mockResolvedValue({ id: "u1" } as never);
    mockDeleteMilestone.mockResolvedValue(undefined);

    await expect(
      deletePersonalProjectMilestoneAction(PROJECT_ID, fakeMilestone.id),
    ).resolves.toEqual({ ok: true, data: true });
    expect(mockDeleteMilestone).toHaveBeenCalledWith("u1", PROJECT_ID, fakeMilestone.id);
  });

  it("updatePersonalProjectMilestoneAction：透传", async () => {
    mockRequireUser.mockResolvedValue({ id: "u1" } as never);
    mockUpdateMilestone.mockResolvedValue(fakeMilestone);

    await expect(
      updatePersonalProjectMilestoneAction(PROJECT_ID, fakeMilestone.id, { name: "新名" }),
    ).resolves.toEqual({ ok: true, data: fakeMilestone });
    expect(mockUpdateMilestone).toHaveBeenCalledWith("u1", PROJECT_ID, fakeMilestone.id, {
      name: "新名",
    });
  });

  it("未登录：requireUser 的 redirect 向上冒泡，不被错误映射吞掉", async () => {
    mockRequireUser.mockRejectedValue(new Error("NEXT_REDIRECT"));
    await expect(
      createPersonalProjectAction({ name: "X" }),
    ).rejects.toThrow("NEXT_REDIRECT");
    await expect(
      addPersonalProjectMilestoneAction(PROJECT_ID, { name: "X" }),
    ).rejects.toThrow("NEXT_REDIRECT");
    expect(mockCreate).not.toHaveBeenCalled();
    expect(mockAddMilestone).not.toHaveBeenCalled();
  });

  it("listPersonalProjectMilestonesAction：透传", async () => {
    mockRequireUser.mockResolvedValue({ id: "u1" } as never);
    mockListMilestones.mockResolvedValue([]);

    await expect(
      listPersonalProjectMilestonesAction(PROJECT_ID),
    ).resolves.toEqual({ ok: true, data: [] });
    expect(mockListMilestones).toHaveBeenCalledWith("u1", PROJECT_ID);
  });

  it("删除个人项目：透传（既有行为回归）", async () => {
    mockRequireUser.mockResolvedValue({ id: "u1" } as never);
    mockDelete.mockResolvedValue(undefined);
    await expect(deletePersonalProjectAction(PROJECT_ID)).resolves.toEqual({ ok: true, data: true });
    expect(mockDelete).toHaveBeenCalledWith("u1", PROJECT_ID);
  });
});
