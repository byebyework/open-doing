import { Tag } from "antd";
import { getTranslations } from "next-intl/server";
import dayjs from "dayjs";

import { UserAvatar } from "@/components/ui/UserAvatar";

import { RemoveMemberButton } from "../members/components/RemoveMemberButton";
import type { MemberView } from "../service";

/** 角色 -> 配色（语言无关）；文案 key 见 ROLE_KEYS，渲染时按请求语言翻译。 */
const ROLE_COLORS: Record<MemberView["membership"]["role"], { color: string; background: string }> = {
  owner: { color: "#7d2ae8", background: "rgba(125, 42, 232, 0.12)" },
  admin: { color: "#7d2ae8", background: "rgba(125, 42, 232, 0.12)" },
  member: { color: "#5f6368", background: "#f1f3f4" },
};

const ROLE_KEYS: Record<MemberView["membership"]["role"], "roleOwner" | "roleAdmin" | "roleMember"> = {
  owner: "roleOwner",
  admin: "roleAdmin",
  member: "roleMember",
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
    // 窄屏（375px）沿用仓库既有的「卡内横滚」模式：成员 / UID / 加入时间
    // 三列在卡片内横向滚动，页面本身不横向溢出。
    <div className="min-w-0 overflow-x-auto">
      <table className="w-full border-collapse text-[13px]">
        <thead>
          <tr className="text-left text-[#9aa0a6]">
            <th className="pb-2 font-medium">{t("colMember")}</th>
            <th className="pb-2 font-medium">{t("colRole")}</th>
            <th className="pb-2 font-medium">{t("colJoinedAt")}</th>
            {actionTeamSlug ? <th className="pb-2 text-right font-medium">{t("colActions")}</th> : null}
          </tr>
        </thead>
        <tbody>
          {members.map(({ membership, user }) => {
            const roleColor = ROLE_COLORS[membership.role];
            return (
              <tr key={membership.id} className="border-t border-[#eceef0]">
                <td className="py-2.5">
                  <span className="flex items-center gap-2.5">
                    <UserAvatar username={user.username} />
                    <span className="font-medium text-[#0e1318]">{user.username}</span>
                    <span className="font-mono text-[12px] text-[#9aa0a6]">{user.uid}</span>
                  </span>
                </td>
                <td className="py-2.5">
                  <Tag style={{ color: roleColor.color, background: roleColor.background, border: "none", borderRadius: 999 }}>
                    {t(ROLE_KEYS[membership.role])}
                  </Tag>
                </td>
                <td className="py-2.5 text-[#5f6368]">{dayjs(membership.joinedAt).format("MM-DD")}</td>
                {actionTeamSlug ? (
                  <td className="py-2.5 text-right">
                    {membership.role === "owner" || membership.userId === currentUserId ? null : (
                      <RemoveMemberButton
                        teamSlug={actionTeamSlug}
                        targetUserId={user.id}
                        targetUsername={user.username}
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
