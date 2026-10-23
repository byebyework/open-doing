import { describe, expect, it } from "vitest";

import {
  TaskPermissionError,
  assertCanAssignTask,
  assertCanDeleteTask,
  assertCanEditTask,
  canAssignTask,
  canComment,
  canCreateTask,
  canDeleteTask,
  canEditTask,
} from "./permissions";

const ACTOR = "user-actor";
const OTHER = "user-other";

const roles = ["owner", "admin", "member"] as const;

describe("团队任务权限", () => {
  it("任何成员都能建任务与评论，非成员不能", () => {
    for (const role of roles) {
      expect(canCreateTask(role)).toBe(true);
      expect(canComment(role)).toBe(true);
    }
    expect(canCreateTask(null)).toBe(false);
    expect(canComment(null)).toBe(false);
  });

  it("编辑/删除/改派：owner、admin 可操作任意任务", () => {
    for (const role of ["owner", "admin"] as const) {
      for (const input of [
        { role, actorId: ACTOR, assigneeId: OTHER },
        { role, actorId: ACTOR, assigneeId: null },
      ]) {
        expect(canEditTask(input)).toBe(true);
        expect(canDeleteTask(input)).toBe(true);
        expect(canAssignTask(input)).toBe(true);
      }
    }
  });

  it("member 只能操作指派给自己的任务，未指派任务也不行", () => {
    expect(canEditTask({ role: "member", actorId: ACTOR, assigneeId: ACTOR })).toBe(true);
    expect(canDeleteTask({ role: "member", actorId: ACTOR, assigneeId: ACTOR })).toBe(true);
    expect(canAssignTask({ role: "member", actorId: ACTOR, assigneeId: ACTOR })).toBe(true);

    for (const check of [canEditTask, canDeleteTask, canAssignTask]) {
      expect(check({ role: "member", actorId: ACTOR, assigneeId: OTHER })).toBe(false);
      expect(check({ role: "member", actorId: ACTOR, assigneeId: null })).toBe(false);
    }
  });

  it("非成员一律拒绝", () => {
    expect(canEditTask({ role: null, actorId: ACTOR, assigneeId: ACTOR })).toBe(false);
    expect(canDeleteTask({ role: null, actorId: ACTOR, assigneeId: ACTOR })).toBe(false);
    expect(canAssignTask({ role: null, actorId: ACTOR, assigneeId: ACTOR })).toBe(false);
  });

  it("断言函数抛出带 action 的 TaskPermissionError", () => {
    const denied = { role: "member" as const, actorId: ACTOR, assigneeId: OTHER };

    expect(() => assertCanEditTask(denied)).toThrow(
      expect.objectContaining({ name: "TaskPermissionError", action: "task:edit" }),
    );
    expect(() => assertCanDeleteTask(denied)).toThrow(
      expect.objectContaining({ name: "TaskPermissionError", action: "task:delete" }),
    );
    expect(() => assertCanAssignTask(denied)).toThrow(
      expect.objectContaining({ name: "TaskPermissionError", action: "task:assign" }),
    );
    expect(() => assertCanEditTask(denied)).toThrow(TaskPermissionError);
  });
});
