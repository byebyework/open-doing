"use server";

import type { Project, ProjectMilestone, TaskPriority } from "@open-doing/types";

import type { ActionResult } from "@/features/auth/actions";
import { requireUser } from "@/features/auth/session";
import { DomainError } from "@/lib/domain-error";

import type { ProjectMilestoneInput } from "@/features/projects/service";
import {
  addPersonalProjectMilestone,
  createPersonalProject,
  deletePersonalProject,
  deletePersonalProjectMilestone,
  updatePersonalProject,
} from "./service";
import { standardFailuresForRequest } from "@/lib/action-failure";

type Failure = Extract<ActionResult<never>, { ok: false }>;

/**
 * 领域错误 -> 字段错误；未知错误只返回通用提示，避免泄露内部信息。
 *
 * 复用 auth 的 `ActionResult` 契约，个人空间所有 Server Action 返回值一致。
 */
async function toFailure(error: unknown): Promise<Failure> {
  if (error instanceof DomainError) {
    // 个人项目领域文案在 personal 命名空间；无 i18n 通道时回退 message（zh 兜底）。
    if (error.i18n) {
      const failures = await standardFailuresForRequest();
      return {
        ok: false,
        errors: {
          [error.field ?? "form"]: failures
            .custom(`personal.${error.i18n.key}`, error.i18n.params).errors.form!,
        },
      };
    }
    return { ok: false, errors: { [error.field ?? "form"]: error.message } };
  }

  console.error("[personal/projects] Server Action 执行失败", error);
  return (await standardFailuresForRequest()).unexpected();
}

/**
 * 创建个人项目。
 *
 * `requireUser()` 在 try 之外调用：未登录时 `redirect()` 抛出的
 * NEXT_REDIRECT 必须继续向上冒泡，不能被错误映射吞掉。
 */
export async function createPersonalProjectAction(input: {
  name: string;
  description?: string;
  /** 起止日期（`YYYY-MM-DD`，可空）。 */
  startDate?: string | null;
  endDate?: string | null;
  /** 项目优先级；缺省 medium。 */
  priority?: TaskPriority;
  /** 初始项目标签（全量覆写）。 */
  tagIds?: string[];
  /** 初始里程碑（随表单一次性提交）。 */
  milestones?: ProjectMilestoneInput[];
}): Promise<ActionResult<Project>> {
  const user = await requireUser();

  try {
    const project = await createPersonalProject(user.id, input);
    return { ok: true, data: project };
  } catch (error) {
    return toFailure(error);
  }
}

/** 更新个人项目（仅本人；slug 保持不变）。 */
export async function updatePersonalProjectAction(
  projectId: string,
  input: {
    name?: string;
    description?: string;
    /** 起止日期；`null` 清空。 */
    startDate?: string | null;
    endDate?: string | null;
    /** 项目优先级；未传保持不变。 */
    priority?: TaskPriority;
    /** 项目标签全量覆写；仅写 project_tags。 */
    tagIds?: string[];
  },
): Promise<ActionResult<Project>> {
  const user = await requireUser();

  try {
    const project = await updatePersonalProject(user.id, projectId, input);
    return { ok: true, data: project };
  } catch (error) {
    return toFailure(error);
  }
}

/** 删除个人项目（仅本人；项目内任务由数据库级联删除）。 */
export async function deletePersonalProjectAction(
  projectId: string,
): Promise<ActionResult<true>> {
  const user = await requireUser();

  try {
    await deletePersonalProject(user.id, projectId);
    return { ok: true, data: true };
  } catch (error) {
    return toFailure(error);
  }
}

/** 新增个人项目里程碑（owner-only，服务层断言归属）。 */
export async function addPersonalProjectMilestoneAction(
  projectId: string,
  input: {
    name: string;
    description?: string;
    /** 时间节点（`YYYY-MM-DD`，可空）。 */
    dueDate?: string | null;
  },
): Promise<ActionResult<ProjectMilestone>> {
  const user = await requireUser();

  try {
    const milestone = await addPersonalProjectMilestone(user.id, projectId, input);
    return { ok: true, data: milestone };
  } catch (error) {
    return toFailure(error);
  }
}

/** 删除个人项目里程碑（owner-only，服务层断言归属）。 */
export async function deletePersonalProjectMilestoneAction(
  projectId: string,
  milestoneId: string,
): Promise<ActionResult<true>> {
  const user = await requireUser();

  try {
    await deletePersonalProjectMilestone(user.id, projectId, milestoneId);
    return { ok: true, data: true };
  } catch (error) {
    return toFailure(error);
  }
}
