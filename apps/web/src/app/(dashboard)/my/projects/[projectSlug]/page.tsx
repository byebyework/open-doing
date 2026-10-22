import { notFound } from "next/navigation";

import { requireUser } from "@/features/auth/session";
import { PersonalProjectHeaderActions } from "@/features/personal/projects/components/PersonalProjectHeaderActions";
import { getPersonalProjectBySlug } from "@/features/personal/projects/service";

interface PersonalProjectPageProps {
  /** Next 16：动态路由参数为 Promise，必须 await。 */
  params: Promise<{ projectSlug: string }>;
}

/**
 * 个人项目占位页（P-1）。
 *
 * 仅展示项目名 / 描述与编辑、删除入口；P-3 会整体替换为
 * 「列表 + 看板」完整项目页。非本人或不存在一律 404，不泄露存在性。
 */
export default async function PersonalProjectPage({
  params,
}: PersonalProjectPageProps) {
  const { projectSlug } = await params;
  const user = await requireUser();
  const project = await getPersonalProjectBySlug(user.id, projectSlug);

  if (!project) notFound();

  return (
    <div className="mx-auto w-full max-w-[1080px]">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-[13px] text-[#9aa0a6]">
            个人空间 / {project.name}
          </p>
          <h1 className="mt-1 text-[30px] font-bold leading-[1.15] tracking-[-0.01em] text-[#0e1318]">
            {project.name}
          </h1>
          <p className="mt-1 text-[14px] text-[#5f6368]">
            个人项目 · 仅自己可见
          </p>
        </div>

        <PersonalProjectHeaderActions
          project={{
            id: project.id,
            name: project.name,
            description: project.description,
          }}
        />
      </header>

      <section className="mt-6 min-w-0 rounded-xl border border-[#e1e3e6] bg-white p-5 shadow-[0_1px_3px_rgba(14,19,24,0.04)]">
        <h2 className="text-[15px] font-semibold text-[#0e1318]">项目描述</h2>
        <p className="mt-2 whitespace-pre-wrap text-[13px] text-[#5f6368]">
          {project.description ?? "暂无描述"}
        </p>
        <p className="mt-6 text-[12.5px] text-[#9aa0a6]">
          项目任务列表与看板将在后续版本中接入。
        </p>
      </section>
    </div>
  );
}
