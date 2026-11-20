import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";

import { PageHeader } from "@/components/ui/PageHeader";
import { requireUser } from "@/features/auth/session";
import { TagsModuleView } from "@/features/tags/components/TagsModuleView";
import { listTags } from "@/features/tags/service";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("labels");
  return { title: t("title") };
}

/** 个人空间标签模块：全池可见可管理（owner 即本人）。 */
export default async function PersonalTagsPage() {
  const t = await getTranslations("labels");
  const user = await requireUser();
  const tags = await listTags({ ownerId: user.id });

  return (
    <div className="mx-auto w-full min-w-0 max-w-[1320px]">
      <PageHeader title={t("title")} subtitle={t("subtitle")} />
      <div className="mt-6">
        <TagsModuleView space={{ kind: "personal" }} initialTags={tags} canManage />
      </div>
    </div>
  );
}
