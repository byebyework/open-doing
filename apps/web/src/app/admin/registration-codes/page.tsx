import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";

import { PageHeader } from "@/components/ui/PageHeader";
import { CodesTable } from "@/features/admin/components/codes-table";
import { CreateCodeDialog } from "@/features/admin/components/create-code-dialog";
import { listAdminCodes } from "@/features/admin/service";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("admin");

  return { title: t("navRegistrationCodes") };
}

/**
 * 注册码管理（`/admin/registration-codes`，纯 RSC）。
 *
 * 实时读取全部注册码（含凭码注册的用户），页头右侧的新增按钮与
 * 可展开的使用者行都在 client 组件内；本页只负责取数与装配。
 * 入口可达性由 `/admin` 布局的 `requireAdmin()` 保证，写操作在
 * `createRegistrationCodeAction` 内自行鉴权。
 */
export default async function AdminRegistrationCodesPage() {
  const t = await getTranslations("admin");
  const codes = await listAdminCodes();

  return (
    <div className="mx-auto w-full min-w-0 max-w-[1080px]">
      <PageHeader
        title={t("codesTitle")}
        subtitle={t("codesSubtitle")}
        actions={<CreateCodeDialog />}
      />
      <CodesTable codes={codes} />
    </div>
  );
}
