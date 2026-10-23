import { notFound } from "next/navigation";

import { requireUser } from "@/features/auth/session";
import { listPersonalProjects } from "@/features/personal/projects/service";
import { TaskDetailClient } from "@/features/personal/tasks/components/TaskDetailClient";
import { getPersonalTaskDetail } from "@/features/personal/tasks/service";

interface PersonalTaskDetailPageProps {
  /** Next 16：动态路由参数为 Promise，必须 await。 */
  params: Promise<{ taskId: string }>;
}

/**
 * 个人任务详情页（P-4）。
 *
 * 页面保持 RSC：`requireUser()` 后按归属读取详情；不存在 / 非本人 /
 * 非法 ID 一律 404，不泄露任务是否存在。交互全部下沉到 client 包装件。
 */
export default async function PersonalTaskDetailPage({
  params,
}: PersonalTaskDetailPageProps) {
  const { taskId } = await params;

  const user = await requireUser();
  const task = await getPersonalTaskDetail(user.id, taskId);

  if (!task) notFound();

  // 返回地址：任务所属个人项目页；不属于项目时回到「我的任务」。
  let backHref = "/my";
  if (task.projectId) {
    const projects = await listPersonalProjects(user.id);
    const project = projects.find((item) => item.id === task.projectId);
    if (project) {
      backHref = `/my/projects/${project.slug}`;
    }
  }

  return (
    <TaskDetailClient
      task={{ ...task, creatorName: user.username }}
      backHref={backHref}
      currentUserId={user.id}
    />
  );
}
