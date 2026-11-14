import { displayName } from "@open-doing/types";
import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";

import {
  AccountCard,
  SelfActionsCard,
  SessionsCard,
  TeamsCard,
  UserIdentityHeader,
} from "@/features/admin/components/detail-cards";
import { UserActionsCard } from "@/features/admin/components/user-actions";
import { requireAdmin } from "@/features/admin/guard";
import { getAdminUserDetail } from "@/features/admin/service";

/**
 * 目标 userId 必须是 UUID：`users.id` 是 PG uuid 列，非 UUID 字符串直接进入
 * 查询会抛数据库错误。与 `features/admin/actions.ts` 保持同一校验口径；
 * "use server" 文件只能导出 async 函数，故此处独立声明。
 */
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function generateMetadata({
  params,
}: PageProps<"/admin/users/[userId]">): Promise<Metadata> {
  const t = await getTranslations("admin");
  const { userId } = await params;

  if (!UUID_PATTERN.test(userId)) return { title: t("usersTitle") };

  const detail = await getAdminUserDetail(userId);
  if (!detail) return { title: t("usersTitle") };

  return {
    title: t("detailMetaTitle", { name: displayName(detail.user) }),
  };
}

/**
 * 用户详情页（`/admin/users/{id}`，RSC）。
 *
 * 对照 `admin-user-detail.html`：面包屑 + 身份头部（xl 头像 / 昵称 / uid /
 * 状态与身份徽标），下方两列——左列所属团队与最近会话，右列账号信息与
 * 管理操作。非法 / 未知 id 一律 `notFound()`，不泄露存在性。
 *
 * 破坏性操作按当前管理员身份过滤：查看自己时右侧只显示只读提示，不渲染
 * 禁用 / 授予 / 撤销按钮；服务层 selfOperation 仍是兜底。布局层的
 * `requireAdmin()` 只保证可达性，本页另取 actor 用于自我比对。
 */
export default async function AdminUserDetailPage({
  params,
}: PageProps<"/admin/users/[userId]">) {
  const { userId } = await params;
  if (!UUID_PATTERN.test(userId)) notFound();

  const actor = await requireAdmin();
  const detail = await getAdminUserDetail(userId);
  if (!detail) notFound();

  const [t, tCommon] = await Promise.all([
    getTranslations("admin"),
    getTranslations("common"),
  ]);
  const name = displayName(detail.user);
  const isSelf = actor.id === detail.user.id;

  return (
    <div className="mx-auto w-full min-w-0 max-w-[1080px]">
      <nav
        aria-label={tCommon("breadcrumb")}
        className="flex min-w-0 items-center gap-2 text-[13px] text-[var(--ink-400)]"
      >
        <span className="shrink-0">{t("consoleTitle")}</span>
        <span aria-hidden="true">/</span>
        <Link
          href="/admin/users"
          className="shrink-0 text-[var(--ink-400)] no-underline hover:text-[var(--purple-600)]"
        >
          {t("detailBreadcrumbUsers")}
        </Link>
        <span aria-hidden="true">/</span>
        <strong className="truncate font-semibold text-[var(--ink-900)]">
          {name}
        </strong>
      </nav>

      <UserIdentityHeader user={detail.user} />

      <div className="mt-4 grid grid-cols-1 gap-4 min-[1101px]:grid-cols-[minmax(0,1fr)_340px]">
        <div className="flex min-w-0 flex-col gap-4">
          <TeamsCard teams={detail.teams} />
          <SessionsCard sessions={detail.sessions} />
        </div>
        <div className="flex min-w-0 flex-col gap-4">
          <AccountCard user={detail.user} />
          {isSelf ? (
            <SelfActionsCard />
          ) : (
            <UserActionsCard
              userId={detail.user.id}
              name={name}
              isAdmin={detail.user.isAdmin}
              isDisabled={detail.user.isDisabled}
            />
          )}
        </div>
      </div>
    </div>
  );
}
