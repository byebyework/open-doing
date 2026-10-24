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
import { DissolveTeamButton } from "@/features/teams/members/components/DissolveTeamButton";
import { LeaveTeamButton } from "@/features/teams/members/components/LeaveTeamButton";
import { TransferTeamButton } from "@/features/teams/members/components/TransferTeamButton";
import { listPendingSentInvites } from "@/features/teams/invites/service";

export const metadata: Metadata = {
  title: "团队设置 · Open Doing",
};

/**
 * 团队设置页（T 轨道骨架）。
 *
 * 所有成员可进：member 仅见只读成员表；owner/admin 额外见邀请区。
 * 改名/成员管理/危险操作等区块按角色显隐（G-4），写操作一律在 action 端再校验。
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
  const canRemoveMember = can(membership.role, "team:remove_member");
  const canLeave = can(membership.role, "team:leave");
  const canTransfer = can(membership.role, "team:transfer");
  const canDissolve = can(membership.role, "team:dissolve");

  const members = await listMembers(team.id);
  const pendingSent = canManage ? await listPendingSentInvites(team.id) : [];
  // 受让人下拉排除当前 owner（转让给自己由 service 拒绝）。
  const transferCandidates = members
    .filter(({ membership: memberMembership }) => memberMembership.role !== "owner")
    .map(({ user: memberUser }) => ({
      userId: memberUser.id,
      username: memberUser.username,
      uid: memberUser.uid,
    }));

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
        <MemberList
          members={members}
          teamSlug={team.slug}
          canManage={canRemoveMember}
          currentUserId={user.id}
        />
      </section>

      <section className="mt-5 rounded-xl border border-[#e1e3e6] bg-white p-5 shadow-[0_1px_3px_rgba(14,19,24,0.04)]">
        <h2 className="mb-2 text-[15px] font-bold text-[#ff5757]">危险操作</h2>

        {canLeave ? (
          <div className="flex items-center gap-4 py-3">
            <div className="min-w-0 flex-1">
              <div className="text-[14px] font-semibold text-[#0e1318]">退出团队</div>
              <div className="mt-1 text-[13px] text-[#5f6368]">
                退出后你负责的任务将变为未指派，由管理员重新分配。
              </div>
            </div>
            <div className="flex-none">
              <LeaveTeamButton teamSlug={team.slug} />
            </div>
          </div>
        ) : null}

        {canTransfer ? (
          <div className={canLeave ? "flex items-center gap-4 border-t border-[#e1e3e6] py-3" : "flex items-center gap-4 py-3"}>
            <div className="min-w-0 flex-1">
              <div className="text-[14px] font-semibold text-[#0e1318]">转让团队</div>
              <div className="mt-1 text-[13px] text-[#5f6368]">
                转让后受让人成为所有者，你将变为管理员；团队内容不受影响。
              </div>
            </div>
            <div className="flex-none">
              <TransferTeamButton teamSlug={team.slug} candidates={transferCandidates} />
            </div>
          </div>
        ) : null}

        {canDissolve ? (
          <div className="flex items-center gap-4 border-t border-[#e1e3e6] py-3">
            <div className="min-w-0 flex-1">
              <div className="text-[14px] font-semibold text-[#0e1318]">解散团队</div>
              <div className="mt-1 text-[13px] text-[#5f6368]">
                仅所有者可操作；将永久删除团队下全部项目、任务、评论与通知。
              </div>
            </div>
            <div className="flex-none">
              <DissolveTeamButton teamSlug={team.slug} teamName={team.name} />
            </div>
          </div>
        ) : null}
      </section>
    </div>
  );
}
