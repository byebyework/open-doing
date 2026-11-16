import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";

import { requireUser } from "@/features/auth/session";
import { DaysBoard } from "@/features/days/components/DaysBoard";
import { listImportantDays } from "@/features/days/service";
import { todayInShanghai } from "@/lib/today";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("meta");
  return { title: t("daysTitle") };
}

/**
 * 个人空间「重要日子」模块页（RSC）。
 *
 * 只负责取数：当前用户的全量列表由 service 按置顶 / 方向排序，
 * `today` 按 Asia/Shanghai 口径计算后一并传入；所有交互（卡片墙、
 * 新建 / 编辑弹窗、删除确认、置顶）都下沉到客户端 `DaysBoard`。
 *
 * 仅个人空间建此路由；团队空间访问 `/space/{slug}/days` 因无路由天然 404。
 */
export default async function PersonalDaysPage() {
  const user = await requireUser();
  const today = todayInShanghai();
  const days = await listImportantDays({ userId: user.id, today });

  return (
    <div className="mx-auto w-full min-w-0 max-w-[1320px]">
      <DaysBoard initialDays={days} today={today} />
    </div>
  );
}
