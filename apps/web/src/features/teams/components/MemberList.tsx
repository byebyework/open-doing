import { displayName } from "@open-doing/types";
import { getTranslations } from "next-intl/server";
import dayjs from "dayjs";

import { UserAvatar } from "@/components/ui/UserAvatar";
import { Badge } from "@/components/ui/shadcn/badge";

import { RemoveMemberButton } from "../members/components/RemoveMemberButton";
import type { MemberView } from "../service";

/** 角色 -> Badge 变体（语言无关，取 tokens.css 状态色组）；文案 key 见 ROLE_KEYS。 */
const ROLE_VARIANTS: Record<MemberView["membership"]["role"], "info" | "neutral"> = {
  owner: "info",
  admin: "info",
  member: "neutral",
};

const ROLE_KEYS: Record<MemberView["membership"]["role"], "roleOwner" | "roleAdmin" | "roleMember"> = {
  owner: "roleOwner",
  admin: "roleAdmin",
  member: "roleMember",
};

/** 性别取值 -> i18n key（口径与注册 / 个人资料表单一致）。 */
const GENDER_KEYS: Record<NonNullable<MemberView["user"]["gender"]>, "genderMale" | "genderFemale" | "genderSecret"> = {
  male: "genderMale",
  female: "genderFemale",
  secret: "genderSecret",
};

export interface MemberListProps {
  members: MemberView[];
  /** 传入团队 slug 且 canManage 为真时，渲染移除操作列。 */
  teamSlug?: string;
  /** owner/admin 可移除成员；member 只读。 */
  canManage?: boolean;
  /** 当前登录用户：自己所在行不显示移除按钮（避免自移除后落到 404）。 */
  currentUserId?: string;
}

/**
 * 团队成员列表（server 组件）。
 *
 * 只读展示；owner/admin 额外看到每行「移除」按钮（owner 行与自己的行除外），
 * 成员行的移除操作在 client 组件内二次确认并调用 server action。
 */
export async function MemberList({
  members,
  teamSlug,
  canManage = false,
  currentUserId,
}: MemberListProps) {
  const t = await getTranslations("teams");
  const actionTeamSlug = canManage ? teamSlug : undefined;

  return (
    // 窄屏（375px）沿用仓库既有的「卡内横滚」模式：成员 / UID / 资料 / 加入时间
    // 等列在卡片内横向滚动，页面本身不横向溢出。
    <div className="min-w-0 overflow-x-auto">
      <table className="w-full border-collapse text-[13px]">
        <thead>
          <tr className="text-left text-[var(--ink-400)]">
            <th className="pb-2 font-medium">{t("colMember")}</th>
            <th className="pb-2 font-medium">{t("colRole")}</th>
            <th className="whitespace-nowrap pb-2 font-medium">{t("memberGender")}</th>
            <th className="whitespace-nowrap pb-2 font-medium">{t("memberEmail")}</th>
            <th className="whitespace-nowrap pb-2 font-medium">{t("memberPhone")}</th>
            <th className="whitespace-nowrap pb-2 font-medium">{t("colJoinedAt")}</th>
            {actionTeamSlug ? <th className="pb-2 text-right font-medium">{t("colActions")}</th> : null}
          </tr>
        </thead>
        <tbody>
          {members.map(({ membership, user }) => {
            const roleVariant = ROLE_VARIANTS[membership.role];
            return (
              <tr key={membership.id} className="border-t border-[#eceef0]">
                <td className="py-2.5">
                  <span className="flex items-center gap-2.5">
                    <UserAvatar userId={user.id} name={displayName(user)} />
                    <span className="font-medium text-[var(--ink-900)]">{displayName(user)}</span>
                    <span className="font-mono text-[12px] text-[var(--ink-400)]">{user.uid}</span>
                  </span>
                </td>
                <td className="py-2.5">
                  <Badge
                    variant={roleVariant}
                    className="rounded-[var(--radius-pill)] px-2 py-0 text-[12px] font-medium leading-5"
                  >
                    {t(ROLE_KEYS[membership.role])}
                  </Badge>
                </td>
                <td className="whitespace-nowrap py-2.5 text-[var(--ink-500)]">
                  {user.gender ? t(GENDER_KEYS[user.gender]) : "—"}
                </td>
                <td className="whitespace-nowrap py-2.5 text-[var(--ink-500)]">{user.email ?? "—"}</td>
                <td className="whitespace-nowrap py-2.5 text-[var(--ink-500)]">{user.phone ?? "—"}</td>
                <td className="whitespace-nowrap py-2.5 text-[var(--ink-500)]">{dayjs(membership.joinedAt).format("MM-DD")}</td>
                {actionTeamSlug ? (
                  <td className="py-2.5 text-right">
                    {membership.role === "owner" || membership.userId === currentUserId ? null : (
                      <RemoveMemberButton
                        teamSlug={actionTeamSlug}
                        targetUserId={user.id}
                        targetName={displayName(user)}
                      />
                    )}
                  </td>
                ) : null}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
