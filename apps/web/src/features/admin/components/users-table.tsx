import { displayName } from "@open-doing/types";
import Link from "next/link";
import { getTranslations } from "next-intl/server";

import { CARD_SHELL } from "@/components/ui/card";
import { UserAvatar } from "@/components/ui/UserAvatar";
import { Badge } from "@/components/ui/shadcn/badge";
import { Button } from "@/components/ui/shadcn/button";
import { formatTaskTimestamp } from "@/lib/date-display";

import type { AdminUserSummary } from "../service";

/** 表头单元格样式（原型 .table th：12px 大写字距加宽、淡色）。 */
const TH_CLASS =
  "border-b border-[var(--border-default)] px-3 pb-3 text-left text-[12px] font-semibold uppercase tracking-[0.04em] text-[var(--ink-400)]";

/** 主行单元格样式（原型 .table td：12px 内边距、行间分隔线）。 */
const TD_CLASS =
  "border-b border-[var(--border-default)] px-3 py-3 align-middle";

/** 状态 / 身份徽标样式（原型 .badge-done / .badge-disabled / .badge-admin）。 */
const BADGE_CLASS = "px-2 py-0 text-[12px] font-semibold";
const BADGE_DISABLED = "bg-[var(--error-bg)] text-[var(--error)]";
const BADGE_ADMIN = "bg-[var(--primary-bg)] text-[var(--purple-600)]";

/** 绝对时刻 → Asia/Shanghai 归属日历日（YYYY-MM-DD，与全站日期口径一致）。 */
function displayDate(value: string): string {
  return formatTaskTimestamp(value).slice(0, 10);
}

/** 用户头像单元格：头像 + 昵称 + uid，整格链接到详情页（原型 a.user-cell）。 */
function UserCell({
  user,
  muted,
}: {
  user: AdminUserSummary;
  muted: boolean;
}) {
  const name = displayName(user);

  return (
    <Link
      href={`/admin/users/${user.id}`}
      className="group flex min-w-0 items-center gap-2 no-underline"
    >
      <UserAvatar userId={user.id} name={name} size={30} />
      <span className="flex min-w-0 items-center gap-1.5">
        <span
          className={`truncate text-[13.5px] font-semibold ${
            muted
              ? "text-[var(--text-faint)]"
              : "text-[var(--ink-900)] group-hover:text-[var(--purple-600)]"
          }`}
        >
          {name}
        </span>
        <span className="truncate font-mono text-[11px] text-[var(--ink-400)]">
          {user.uid}
        </span>
      </span>
    </Link>
  );
}

/**
 * 用户列表（RSC 纯展示表格）。
 *
 * 对照 `admin-users.html`：用户（头像 + 昵称 + uid）/ 邮箱 / 团队数 /
 * 注册时间 / 状态与身份徽标 / 查看按钮。已禁用行整体弱化文字色，
 * 但状态徽标保持醒目（原型 `tr.is-disabled`）。行内两处入口都指向
 * `/admin/users/{id}`（详情页在 Task 10 落地，当前按计划 404）。
 */
export async function UsersTable({ users }: { users: AdminUserSummary[] }) {
  const t = await getTranslations("admin");

  return (
    <section className={`min-w-0 overflow-x-auto ${CARD_SHELL} px-4 py-4 min-[861px]:px-5`}>
      <table className="w-full min-w-[720px] border-collapse text-left text-[13.5px]">
        <thead>
          <tr>
            <th className={TH_CLASS}>{t("colUser")}</th>
            <th className={TH_CLASS}>{t("colEmail")}</th>
            <th className={`${TH_CLASS} whitespace-nowrap`}>{t("colTeams")}</th>
            <th className={`${TH_CLASS} whitespace-nowrap`}>
              {t("colRegisteredAt")}
            </th>
            <th className={`${TH_CLASS} whitespace-nowrap`}>{t("colStatus")}</th>
            <th className={`${TH_CLASS} whitespace-nowrap text-right`}>
              {t("colActions")}
            </th>
          </tr>
        </thead>
        <tbody className="[&_tr:last-child_td]:border-b-0">
          {users.map((user) => (
            <tr
              key={user.id}
              className={`transition-colors hover:bg-[var(--muted)] ${
                user.isDisabled ? "text-[var(--text-faint)]" : ""
              }`}
            >
              <td className={TD_CLASS}>
                <UserCell user={user} muted={user.isDisabled} />
              </td>
              <td
                className={`${TD_CLASS} ${
                  user.isDisabled ? "" : "text-[var(--foreground)]"
                }`}
              >
                {user.email ?? "—"}
              </td>
              <td
                className={`${TD_CLASS} whitespace-nowrap [font-variant-numeric:tabular-nums]`}
              >
                {user.teamCount}
              </td>
              <td
                className={`${TD_CLASS} whitespace-nowrap [font-variant-numeric:tabular-nums] ${
                  user.isDisabled ? "" : "text-[var(--ink-500)]"
                }`}
              >
                {displayDate(user.createdAt)}
              </td>
              <td className={TD_CLASS}>
                <span className="flex flex-wrap items-center gap-1.5">
                  {user.isDisabled ? (
                    <Badge variant="neutral" className={`${BADGE_CLASS} ${BADGE_DISABLED}`}>
                      {t("statusDisabled")}
                    </Badge>
                  ) : (
                    <Badge variant="success" className={BADGE_CLASS}>
                      {t("statusActive")}
                    </Badge>
                  )}
                  {user.isAdmin ? (
                    <Badge variant="neutral" className={`${BADGE_CLASS} ${BADGE_ADMIN}`}>
                      {t("roleAdmin")}
                    </Badge>
                  ) : null}
                </span>
              </td>
              <td className={`${TD_CLASS} whitespace-nowrap text-right`}>
                <Button
                  asChild
                  variant="outline"
                  size="sm"
                  className="text-[var(--foreground)]"
                >
                  <Link href={`/admin/users/${user.id}`}>{t("viewUser")}</Link>
                </Button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
