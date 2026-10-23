import type { Comment, Subtask, Task } from "@open-doing/types";
import { afterEach, describe, expect, it, vi } from "vitest";

import { getCurrentUser } from "@/features/auth/session";
import { TeamPermissionError } from "@/features/teams/permissions";
import { DomainError } from "@/lib/domain-error";

import {
  addTeamCommentAction,
  addTeamSubtaskAction,
  createTeamTaskAction,
  deleteTeamCommentAction,
  deleteTeamTaskAction,
  removeTeamSubtaskAction,
  toggleTeamSubtaskAction,
  updateTeamTaskAction,
} from "./actions";
import { TaskPermissionError } from "./permissions";
import {
  addTeamComment,
  addTeamSubtask,
  createTeamTask,
  deleteTeamComment,
  deleteTeamTask,
  removeTeamSubtask,
  toggleTeamSubtask,
  updateTeamTask,
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
    createTeamTask: vi.fn(),
    updateTeamTask: vi.fn(),
    deleteTeamTask: vi.fn(),
    addTeamSubtask: vi.fn(),
    removeTeamSubtask: vi.fn(),
    toggleTeamSubtask: vi.fn(),
    addTeamComment: vi.fn(),
    deleteTeamComment: vi.fn(),
  };
});

const mockGetCurrentUser = vi.mocked(getCurrentUser);
const mockCreate = vi.mocked(createTeamTask);
const mockUpdate = vi.mocked(updateTeamTask);
const mockDelete = vi.mocked(deleteTeamTask);
const mockAddSubtask = vi.mocked(addTeamSubtask);
const mockRemoveSubtask = vi.mocked(removeTeamSubtask);
const mockToggleSubtask = vi.mocked(toggleTeamSubtask);
const mockAddComment = vi.mocked(addTeamComment);
const mockDeleteComment = vi.mocked(deleteTeamComment);

const TEAM_ID = "00000000-0000-0000-0000-000000000002";
const PROJECT_ID = "00000000-0000-0000-0000-000000000003";
const TASK_ID = "00000000-0000-0000-0000-000000000004";
const MEMBER_ID = "00000000-0000-0000-0000-000000000005";

const fakeTask: Task = {
  id: TASK_ID,
  projectId: PROJECT_ID,
  spaceType: "team",
  title: "写周报",
  description: undefined,
  status: "todo",
  assigneeId: MEMBER_ID,
  dueDate: undefined,
  createdAt: "2026-10-23T00:00:00.000Z",
  updatedAt: "2026-10-23T00:00:00.000Z",
};

const fakeSubtask: Subtask = {
  id: "00000000-0000-0000-0000-000000000006",
  taskId: TASK_ID,
  title: "第一步",
  completed: false,
  createdAt: "2026-10-23T00:00:00.000Z",
};

const fakeComment: Comment = {
  id: "00000000-0000-0000-0000-000000000007",
  taskId: TASK_ID,
  authorId: MEMBER_ID,
  content: "收到",
  createdAt: "2026-10-23T00:00:00.000Z",
};

const sessionUser = {
  id: MEMBER_ID,
  uid: "doing_member",
  username: "alice",
  createdAt: "",
};

/** 覆盖全部 8 个 action 的调用形式（未登录用例共用）。 */
const allActions = [
  () => createTeamTaskAction({ teamId: TEAM_ID, projectId: PROJECT_ID, title: "X" }),
  () => updateTeamTaskAction(TASK_ID, { teamId: TEAM_ID, title: "X" }),
  () => deleteTeamTaskAction({ teamId: TEAM_ID, taskId: TASK_ID }),
  () => addTeamSubtaskAction({ teamId: TEAM_ID, taskId: TASK_ID, title: "子" }),
  () => removeTeamSubtaskAction({ teamId: TEAM_ID, taskId: TASK_ID, subtaskId: fakeSubtask.id }),
  () =>
    toggleTeamSubtaskAction({
      teamId: TEAM_ID,
      taskId: TASK_ID,
      subtaskId: fakeSubtask.id,
      completed: true,
    }),
  () => addTeamCommentAction({ teamId: TEAM_ID, taskId: TASK_ID, content: "评论" }),
  () => deleteTeamCommentAction({ teamId: TEAM_ID, taskId: TASK_ID, commentId: fakeComment.id }),
];

const mockedServices = [
  mockCreate,
  mockUpdate,
  mockDelete,
  mockAddSubtask,
  mockRemoveSubtask,
  mockToggleSubtask,
  mockAddComment,
  mockDeleteComment,
];

describe("团队任务 actions", () => {
  afterEach(() => {
    vi.resetAllMocks();
  });

  it("未登录：全部返回 form 错误「请先登录」，且不触达 service", async () => {
    mockGetCurrentUser.mockResolvedValue(null);

    for (const action of allActions) {
      await expect(action()).resolves.toEqual({
        ok: false,
        errors: { form: "请先登录" },
      });
    }

    for (const service of mockedServices) {
      expect(service).not.toHaveBeenCalled();
    }
  });

  it("任务权限错误：映射为 form「没有权限执行该操作」", async () => {
    mockGetCurrentUser.mockResolvedValue(sessionUser);
    mockUpdate.mockRejectedValue(new TaskPermissionError("task:edit"));

    await expect(
      updateTeamTaskAction(TASK_ID, { teamId: TEAM_ID, title: "X" }),
    ).resolves.toEqual({ ok: false, errors: { form: "没有权限执行该操作" } });
  });

  it("团队权限错误：映射为 form「没有权限执行该操作」", async () => {
    mockGetCurrentUser.mockResolvedValue(sessionUser);
    mockDelete.mockRejectedValue(new TeamPermissionError("team:manage_projects"));

    await expect(
      deleteTeamTaskAction({ teamId: TEAM_ID, taskId: TASK_ID }),
    ).resolves.toEqual({ ok: false, errors: { form: "没有权限执行该操作" } });
  });

  it("领域错误：按字段映射", async () => {
    mockGetCurrentUser.mockResolvedValue(sessionUser);
    mockCreate.mockRejectedValue(new DomainError("请输入任务标题", "title"));

    await expect(
      createTeamTaskAction({ teamId: TEAM_ID, projectId: PROJECT_ID, title: "" }),
    ).resolves.toEqual({ ok: false, errors: { title: "请输入任务标题" } });
  });

  it("未知异常：只返回通用文案", async () => {
    mockGetCurrentUser.mockResolvedValue(sessionUser);
    mockAddComment.mockRejectedValue(new Error("boom"));

    await expect(
      addTeamCommentAction({ teamId: TEAM_ID, taskId: TASK_ID, content: "评论" }),
    ).resolves.toEqual({ ok: false, errors: { form: "操作失败，请稍后重试" } });
  });

  it("成功：透传数据，并以当前用户作为 actorId 调用 service", async () => {
    mockGetCurrentUser.mockResolvedValue(sessionUser);
    mockCreate.mockResolvedValue(fakeTask);
    mockDelete.mockResolvedValue(undefined);

    await expect(
      createTeamTaskAction({ teamId: TEAM_ID, projectId: PROJECT_ID, title: "写周报" }),
    ).resolves.toEqual({ ok: true, data: fakeTask });
    await expect(
      deleteTeamTaskAction({ teamId: TEAM_ID, taskId: TASK_ID }),
    ).resolves.toEqual({ ok: true, data: true });

    expect(mockCreate).toHaveBeenCalledWith({
      teamId: TEAM_ID,
      projectId: PROJECT_ID,
      title: "写周报",
      actorId: MEMBER_ID,
    });
    expect(mockDelete).toHaveBeenCalledWith({
      teamId: TEAM_ID,
      taskId: TASK_ID,
      actorId: MEMBER_ID,
    });
  });
});
