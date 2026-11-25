"use server";

import type { Project, ProjectMilestone, ProjectStatus, TaskPriority } from "@open-doing/types";

import type { ActionResult } from "@/features/auth/actions";
import { getCurrentUser } from "@/features/auth/session";
import { TeamPermissionError } from "@/features/teams/permissions";
import { DomainError } from "@/lib/domain-error";

import type { ProjectComment, ProjectMilestoneInput } from "./service";
import {
  addProjectComment,
  addTeamProjectMilestone,
  createTeamProject,
  deleteProjectComment,
  deleteTeamProject,
  deleteTeamProjectMilestone,
  listTeamProjectMilestones,
  updateTeamProject,
  updateTeamProjectMilestone,
  updateTeamProjectStatus,
} from "./service";
import { standardFailuresForRequest } from "@/lib/action-failure";

type Failure = Extract<ActionResult<never>, { ok: false }>;

/** 领域错误 -> 字段错误；未知错误只返回通用提示，避免泄露内部信息。 */
async function toFailure(error: unknown): Promise<Failure> {
  if (error instanceof DomainError) {
    // 项目领域文案在 projects 命名空间；无 i18n 通道时回退 message（zh 兜底）。
    if (error.i18n) {
      const failures = await standardFailuresForRequest();
      return {
        ok: false,
        errors: {
          [error.field ?? "form"]: failures
            .custom(`projects.${error.i18n.key}`, error.i18n.params).errors.form!,
        },
      };
    }
    return { ok: false, errors: { [error.field ?? "form"]: error.message } };
  }
  if (error instanceof TeamPermissionError) {
    return (await standardFailuresForRequest()).forbidden();
  }

  console.error("[projects] Server Action 执行失败", error);
  return (await standardFailuresForRequest()).unexpected();
}

/** 创建团队项目（仅 owner/admin，服务层再次校验）。 */
export async function createTeamProjectAction(input: {
  teamId: string;
  name: string;
  /** 一句话简述（≤100 字符）。 */
  summary?: string;
  description?: string;
  /** 项目状态；缺省 backlog。 */
  status?: ProjectStatus;
  /** 负责人（团队成员）；缺省 null。 */
  leadId?: string | null;
  /** 初始成员（团队成员）。 */
  memberIds?: string[];
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
  const user = await getCurrentUser();
  if (!user) {
    return (await standardFailuresForRequest()).notLoggedIn();
  }

  try {
    const project = await createTeamProject({ ...input, actorId: user.id });
    return { ok: true, data: project };
  } catch (error) {
    return toFailure(error);
  }
}

/** 修改团队项目（仅 owner/admin）；slug 不变。 */
export async function updateTeamProjectAction(input: {
  teamId: string;
  projectId: string;
  name?: string;
  /** 一句话简述；`null`/空串清空。 */
  summary?: string;
  description?: string;
  /** 项目状态；未传保持不变。 */
  status?: ProjectStatus;
  /** 负责人；`null` 清空。 */
  leadId?: string | null;
  /** 项目成员全量覆写。 */
  memberIds?: string[];
  /** 起止日期；`null` 清空。 */
  startDate?: string | null;
  endDate?: string | null;
  /** 项目优先级；未传保持不变。 */
  priority?: TaskPriority;
  /** 项目标签全量覆写；仅写 project_tags。 */
  tagIds?: string[];
}): Promise<ActionResult<Project>> {
  const user = await getCurrentUser();
  if (!user) {
    return (await standardFailuresForRequest()).notLoggedIn();
  }

  try {
    const project = await updateTeamProject({ ...input, actorId: user.id });
    return { ok: true, data: project };
  } catch (error) {
    return toFailure(error);
  }
}

/** 新增团队项目里程碑（仅 owner/admin，服务层再次校验）。 */
export async function addTeamProjectMilestoneAction(input: {
  teamId: string;
  projectId: string;
  name: string;
  description?: string;
  /** 时间节点（`YYYY-MM-DD`，可空）。 */
  dueDate?: string | null;
}): Promise<ActionResult<ProjectMilestone>> {
  const user = await getCurrentUser();
  if (!user) {
    return (await standardFailuresForRequest()).notLoggedIn();
  }

  try {
    const milestone = await addTeamProjectMilestone({ ...input, actorId: user.id });
    return { ok: true, data: milestone };
  } catch (error) {
    return toFailure(error);
  }
}

/** 删除团队项目里程碑（仅 owner/admin，服务层再次校验）。 */
export async function deleteTeamProjectMilestoneAction(input: {
  teamId: string;
  projectId: string;
  milestoneId: string;
}): Promise<ActionResult<true>> {
  const user = await getCurrentUser();
  if (!user) {
    return (await standardFailuresForRequest()).notLoggedIn();
  }

  try {
    await deleteTeamProjectMilestone({ ...input, actorId: user.id });
    return { ok: true, data: true };
  } catch (error) {
    return toFailure(error);
  }
}

/** 删除团队项目（仅 owner/admin）；任务 / 子任务 / 评论 / 通知级联删除。 */
export async function deleteTeamProjectAction(input: {
  teamId: string;
  projectId: string;
}): Promise<ActionResult<true>> {
  const user = await getCurrentUser();
  if (!user) {
    return (await standardFailuresForRequest()).notLoggedIn();
  }

  try {
    await deleteTeamProject({ ...input, actorId: user.id });
    return { ok: true, data: true };
  } catch (error) {
    return toFailure(error);
  }
}

/** 新增项目评论（可见即可评：团队成员 / 个人 owner；服务层再次校验）。 */
export async function addProjectCommentAction(input: {
  projectId: string;
  content: string;
  /** 回复目标评论 id（单层楼中楼，服务层归并到根）。 */
  parentId?: string;
}): Promise<ActionResult<ProjectComment>> {
  const user = await getCurrentUser();
  if (!user) {
    return (await standardFailuresForRequest()).notLoggedIn();
  }

  try {
    const comment = await addProjectComment({ ...input, actorId: user.id });
    return { ok: true, data: comment };
  } catch (error) {
    return toFailure(error);
  }
}

/** 删除项目评论：仅作者本人；错 id / 非作者 → commentNotFound。 */
export async function deleteProjectCommentAction(input: {
  projectId: string;
  commentId: string;
}): Promise<ActionResult<true>> {
  const user = await getCurrentUser();
  if (!user) {
    return (await standardFailuresForRequest()).notLoggedIn();
  }

  try {
    await deleteProjectComment({ ...input, actorId: user.id });
    return { ok: true, data: true };
  } catch (error) {
    return toFailure(error);
  }
}

/** 列出团队项目里程碑（owner/admin，服务层校验；drawer 打开时按需取数）。 */
export async function listTeamProjectMilestonesAction(input: {
  teamId: string;
  projectId: string;
}): Promise<ActionResult<ProjectMilestone[]>> {
  const user = await getCurrentUser();
  if (!user) {
    return (await standardFailuresForRequest()).notLoggedIn();
  }

  try {
    const milestones = await listTeamProjectMilestones(input.teamId, input.projectId);
    return { ok: true, data: milestones };
  } catch (error) {
    return toFailure(error);
  }
}

/** 更新团队项目里程碑（仅 owner/admin，服务层再次校验）。 */
export async function updateTeamProjectMilestoneAction(input: {
  teamId: string;
  projectId: string;
  milestoneId: string;
  name?: string;
  description?: string;
  /** 时间节点；空串清空。 */
  dueDate?: string | null;
}): Promise<ActionResult<ProjectMilestone>> {
  const user = await getCurrentUser();
  if (!user) {
    return (await standardFailuresForRequest()).notLoggedIn();
  }

  try {
    const milestone = await updateTeamProjectMilestone({ ...input, actorId: user.id });
    return { ok: true, data: milestone };
  } catch (error) {
    return toFailure(error);
  }
}

/** 更新团队项目状态（owner/admin）：就地改状态的专用写路径。 */
export async function updateTeamProjectStatusAction(input: {
  teamId: string;
  projectId: string;
  status: ProjectStatus;
}): Promise<ActionResult<Project>> {
  const user = await getCurrentUser();
  if (!user) {
    return (await standardFailuresForRequest()).notLoggedIn();
  }

  try {
    const project = await updateTeamProjectStatus({ ...input, actorId: user.id });
    return { ok: true, data: project };
  } catch (error) {
    return toFailure(error);
  }
}
