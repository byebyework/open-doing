import { getTranslations } from "next-intl/server";

import { PageHeader } from "@/components/ui/PageHeader";
import { OverviewCards } from "@/features/admin/components/overview-cards";
import { getAdminOverview, listAdminCodes } from "@/features/admin/service";

/**
 * 管理概览（`/admin`，纯 RSC）。
 *
 * 并行取概览计数与注册码列表（实时查询、无缓存），再交给无交互的
 * `OverviewCards` 渲染。页面本身不渲染任何 client 组件——侧栏的
 * 路由高亮是唯一的 client 片段，位于布局层。
 */
export default async function AdminOverviewPage() {
  const t = await getTranslations("admin");
  const [overview, codes] = await Promise.all([
    getAdminOverview(),
    listAdminCodes(),
  ]);

  return (
    <div className="mx-auto w-full min-w-0 max-w-[1080px]">
      <PageHeader title={t("overviewTitle")} subtitle={t("overviewSubtitle")} />
      <OverviewCards overview={overview} codes={codes} />
    </div>
  );
}
