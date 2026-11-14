import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";

import { PageHeader } from "@/components/ui/PageHeader";
import {
  UsersFilterBar,
  type UserStatusFilter,
} from "@/features/admin/components/users-filterbar";
import { UsersTable } from "@/features/admin/components/users-table";
import { listAdminUsers } from "@/features/admin/service";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("admin");

  return { title: t("usersTitle") };
}

/** URL `?status=` 归一：未知值一律按 all 处理。 */
function parseStatusFilter(
  value: string | string[] | undefined,
): UserStatusFilter {
  const raw = Array.isArray(value) ? value[0] : value;

  return raw === "active" || raw === "disabled" ? raw : "all";
}

/**
 * 用户管理（`/admin/users`，RSC）。
 *
 * `?q=` 交给 `listAdminUsers`（username / email / uid 子串匹配）；
 * `?status=active|disabled` 在页面层对返回列表做内存过滤（量级足够，
 * 不为筛选增加 SQL 参数）。筛选交互（防抖搜索 + 分段按钮）全部下沉到
 * client 的 `UsersFilterBar`，写回 URL 后由本页重新取数。入口可达性由
 * `/admin` 布局的 `requireAdmin()` 保证；行内写操作在详情页（Task 10）。
 */
export default async function AdminUsersPage({
  searchParams,
}: PageProps<"/admin/users">) {
  const params = await searchParams;
  const t = await getTranslations("admin");
  const rawQuery = Array.isArray(params.q) ? params.q[0] : params.q;
  const query = rawQuery?.trim() ?? "";
  const status = parseStatusFilter(params.status);

  const users = await listAdminUsers(query || null);
  const visibleUsers =
    status === "all"
      ? users
      : users.filter((user) =>
          status === "disabled" ? user.isDisabled : !user.isDisabled,
        );

  return (
    <div className="mx-auto w-full min-w-0 max-w-[1080px]">
      <PageHeader title={t("usersTitle")} subtitle={t("usersSubtitle")} />
      <UsersFilterBar query={query} status={status} />
      <UsersTable users={visibleUsers} />
    </div>
  );
}
