import { displayName } from "@open-doing/types";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";

import { requireUser } from "@/features/auth/session";
import { listTags } from "@/features/tags/service";
import { personalProjectHref, spaceDashboardHref } from "@/lib/routes";
import { parseTaskOrigin, projectTasksBackHref, taskModuleBackHref } from "@/lib/task-origin";
import { listPersonalProjects } from "@/features/personal/projects/service";
import { TaskDetailClient } from "@/features/personal/tasks/components/TaskDetailClient";
import { listPersonalProjectMilestonesWithProgress } from "@/features/personal/projects/service";
import { getPersonalTaskDetail } from "@/features/personal/tasks/service";

interface PersonalTaskDetailPageProps {
  /** Next 16：动态路由参数为 Promise，必须 await。 */
  params: Promise<{ taskId: string }>;
  /** `?from=tasks[&view=list&page&size]`：从任务模块进入时返回任务模块。 */
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

/**
 * 个人任务详情页（P-4）。
 *
 * 页面保持 RSC：`requireUser()` 后按归属读取详情；不存在 / 非本人 /
 * 非法 ID 一律 404，不泄露任务是否存在。交互全部下沉到 client 包装件。
 */
export default async function PersonalTaskDetailPage({
  params,
  searchParams,
}: PersonalTaskDetailPageProps) {
  const { taskId } = await params;
  const origin = parseTaskOrigin(await searchParams);

  const user = await requireUser();
  const t = await getTranslations("tasks");
  const task = await getPersonalTaskDetail(user.id, taskId);

  if (!task) notFound();

  // 返回地址：任务模块来源回到任务列表同一页；否则回所属个人项目页，
  // 不属于项目时回到「我的任务」。
  let backHref = spaceDashboardHref("personal");
  let backLabel = task.projectId ? t("backToProject") : t("backToMyTasks");
  if (origin.fromTasks) {
    backHref = taskModuleBackHref("personal", origin);
    backLabel = t("backToTasks");
  } else if (task.projectId) {
    const projects = await listPersonalProjects(user.id);
    const project = projects.find((item) => item.id === task.projectId);
    if (project) {
      const base = personalProjectHref(project.slug);
      // 项目详情任务 tab 来源：回到 ?tab=tasks 同视图；否则回项目概览。
      backHref = origin.fromProject
        ? projectTasksBackHref(base, origin)
        : base;
    }
  }

  // 任务打标只接受 task 类型标签。
  const taskTagPool = (await listTags({ ownerId: user.id })).filter(
    (tag) => tag.type === "task",
  );

  // 任务所填个人项目的里程碑选项（无项目任务为空）。
  let milestoneOptions: { id: string; name: string }[] = [];
  if (task.projectId) {
    milestoneOptions = (
      await listPersonalProjectMilestonesWithProgress(user.id, task.projectId)
    ).map((item) => ({ id: item.milestone.id, name: item.milestone.name }));
  }

  return (
    <TaskDetailClient
      task={{ ...task, creatorName: displayName(user) }}
      milestoneOptions={milestoneOptions}
      backHref={backHref}
      backLabel={backLabel}
      currentUserId={user.id}
      tagPool={taskTagPool}
    />
  );
}
