import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";

import { PageHeader } from "@/components/ui/PageHeader";
import { requireUser } from "@/features/auth/session";
import { MomentsBoard } from "@/features/moments/components/MomentsBoard";
import { NewMomentButton } from "@/features/moments/components/NewMomentButton";
import { listMoments } from "@/features/moments/service";
import { todayInShanghai } from "@/lib/today";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("meta");
  return { title: t("momentsTitle") };
}

/**
 * 个人空间「时刻」模块页（RSC）。
 *
 * 只负责取数：当前用户的全量列表由 service 按置顶 / 方向排序，
 * `today` 按 Asia/Shanghai 口径计算后一并传入；页头在 RSC 渲染，
 * 新建按钮是独立的客户端组件（自己的对话框状态，对齐 `NewTaskButton`），
 * 卡片墙 / 编辑 / 删除 / 置顶下沉到客户端 `MomentsBoard`。
 *
 * 仅个人空间建此路由；团队空间访问 `/space/{slug}/moments` 因无路由天然 404。
 */
export default async function PersonalMomentsPage() {
  const t = await getTranslations("moments");
  const user = await requireUser();
  const today = todayInShanghai();
  const moments = await listMoments({ userId: user.id, today });

  return (
    <div className="mx-auto w-full min-w-0 max-w-[1320px]">
      <PageHeader
        title={t("page.title")}
        subtitle={t("page.subtitle")}
        actions={<NewMomentButton />}
      />
      <MomentsBoard initialMoments={moments} today={today} />
    </div>
  );
}
