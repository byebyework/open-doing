import { Tag } from "antd";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import dayjs from "dayjs";

import { requireUser } from "@/features/auth/session";
import { UserAvatar } from "@/components/ui/UserAvatar";
import { can, getMembership } from "@/features/teams/permissions";
import { getTeamBySlug, listMembers } from "@/features/teams/service";
import { InviteMemberForm } from "@/features/teams/components/InviteMemberForm";
import { MemberList } from "@/features/teams/components/MemberList";
import { RenameTeamForm } from "@/features/teams/components/RenameTeamForm";
import { RescindInviteButton } from "@/features/teams/components/RescindInviteButton";
import { listPendingSentInvites } from "@/features/teams/invites/service";

export const metadata: Metadata = {
  title: "团队设置 · Open Doing",
};

/**
 * 团队设置页（T 轨道骨架）。
 *
 * 所有成员可进：member 仅见只读成员表；owner/admin 额外见邀请区。
 * 改名/危险操作等区块按角色显隐，写操作一律在 action 端再校验。
 * 离开/解散/转让等危险区由 G 轨道在此追加（本轨道不渲染）。
 */
export default async function TeamSettingsPage(
  props: PageProps<"/teams/[teamSlug]/settings">,
) {
  const { teamSlug } = await props.params;
  const user = await requireUser();

  // 团队不存在或非成员一律 404，不泄露存在性。
  const team = await getTeamBySlug(teamSlug);
  const membership = team ? await getMembership(team.id, user.id) : null;
  if (!team || !membership) notFound();

  const canManage = can(membership.role, "team:invite");
  const members = await listMembers(team.id);
  const pendingSent = canManage ? await listPendingSentInvites(team.id) : [];

  return (
    <div className="mx-auto w-full max-w-[820px] py-8 min-[861px]:py-10">
      <div className="mb-1 text-[13px] text-[#9aa0a6]">
        {team.name} <span className="mx-1">/</span> 团队设置
      </div>
      <h1 className="text-[22px] font-extrabold tracking-[-0.01em] text-[#0e1318]">团队设置</h1>
      <p className="mb-8 mt-1.5 text-[14px] text-[#5f6368]">管理团队信息与成员。</p>

      {canManage ? (
        <section className="mb-5 rounded-xl border border-[#e1e3e6] bg-white p-5 shadow-[0_1px_3px_rgba(14,19,24,0.04)]">
          <h2 className="mb-1 text-[15px] font-bold text-[#0e1318]">团队信息</h2>
          <p className="mb-4 text-[13px] text-[#9aa0a6]">
            创建于 {dayjs(team.createdAt).format("YYYY-MM-DD")}
          </p>

          <RenameTeamForm teamId={team.id} name={team.name} />
        </section>
      ) : null}

      {canManage ? (
        <section className="mb-5 rounded-xl border border-[#e1e3e6] bg-white p-5 shadow-[0_1px_3px_rgba(14,19,24,0.04)]">
          <h2 className="mb-1 text-[15px] font-bold text-[#0e1318]">邀请成员</h2>
          <p className="mb-4 text-[13px] text-[#5f6368]">输入对方 UID 即可邀请，对方登录后处理。</p>

          <InviteMemberForm teamId={team.id} />

          <div className="mt-5">
            <div className="mb-2 text-[13px] font-semibold text-[#0e1318]">
              已发出 · 待处理（{pendingSent.length}）
            </div>
            {pendingSent.map(({ invite, invitee }) => (
              <div
                key={invite.id}
                className="flex items-center gap-3 border-t border-[#eceef0] py-2.5 first:border-t-0"
              >
                <Tag style={{ color: "#6d4fd4", background: "rgba(155, 135, 245, 0.14)", border: "none", borderRadius: 999 }}>
                  待处理
                </Tag>
                <UserAvatar username={invitee.username} />
                <span className="text-[13px] font-medium text-[#0e1318]">{invitee.username}</span>
                <span className="font-mono text-[12px] text-[#9aa0a6]">{invitee.uid}</span>
                <span className="ml-auto text-[12px] text-[#9aa0a6]">
                  {dayjs(invite.createdAt).format("MM-DD HH:mm")} 发出
                </span>
                <RescindInviteButton inviteId={invite.id} teamId={team.id} />
              </div>
            ))}
          </div>
        </section>
      ) : null}

      <section className="rounded-xl border border-[#e1e3e6] bg-white p-5 shadow-[0_1px_3px_rgba(14,19,24,0.04)]">
        <h2 className="mb-4 text-[15px] font-bold text-[#0e1318]">成员（{members.length}）</h2>
        <MemberList members={members} />
      </section>
    </div>
  );
}
