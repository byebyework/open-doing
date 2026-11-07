import { displayName } from "@open-doing/types";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import dayjs from "dayjs";

import { requireUser } from "@/features/auth/session";
import { CARD_SHELL } from "@/components/ui/card";
import { HintBadge } from "@/components/ui/HintBadge";
import { PageHeader } from "@/components/ui/PageHeader";
import { UserAvatar } from "@/components/ui/UserAvatar";
import { Badge } from "@/components/ui/shadcn/badge";
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
import { JoinCodeSettings } from "@/features/teams/joins/components/JoinCodeSettings";
import { JoinRequestList } from "@/features/teams/joins/components/JoinRequestList";
import { getTeamJoinSettings, listTeamJoinRequests } from "@/features/teams/joins/service";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("meta");

  return { title: t("teamSettingsTitle") };
}

/**
 * 团队设置页（T 轨道骨架）。
 *
 * 所有成员可进：member 仅见只读成员表；owner/admin 额外见邀请区。
 * 改名/成员管理/危险操作等区块按角色显隐（G-4），写操作一律在 action 端再校验。
 */
export default async function TeamSettingsPage(
  props: PageProps<"/space/[teamSlug]/settings">,
) {
  const { teamSlug } = await props.params;
  const user = await requireUser();
  const t = await getTranslations("teams");

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
  // 凭码加入设置与审批队列仅 owner/admin 可见（member 视角不渲染入口）。
  const joinSettings = canManage ? await getTeamJoinSettings(team.id) : null;
  const joinRequests = canManage ? await listTeamJoinRequests(team.id) : [];
  // 受让人下拉排除当前 owner（转让给自己由 service 拒绝）。
  const transferCandidates = members
    .filter(({ membership: memberMembership }) => memberMembership.role !== "owner")
    .map(({ user: memberUser }) => ({
      userId: memberUser.id,
      name: displayName(memberUser),
      uid: memberUser.uid,
    }));

  return (
    <div className="mx-auto w-full max-w-[820px] py-8 min-[861px]:py-10">
      <div className="mb-1 text-[13px] text-[var(--ink-400)]">
        {team.name} <span className="mx-1">/</span> {t("settingsHeading")}
      </div>
      <PageHeader
        className="mb-8"
        title={t("settingsHeading")}
        subtitle={t("settingsSubtitle")}
      />

      {canManage ? (
        <section className={`mb-5 ${CARD_SHELL} p-5`}>
          <h2 className="mb-1 text-[15px] font-bold text-[var(--ink-900)]">{t("teamInfoTitle")}</h2>
          <p className="mb-4 text-[13px] text-[var(--ink-400)]">
            {t("createdAtLine", { date: dayjs(team.createdAt).format("YYYY-MM-DD") })}
          </p>

          <RenameTeamForm teamId={team.id} name={team.name} />
        </section>
      ) : null}

      {canManage ? (
        <section className={`mb-5 ${CARD_SHELL} p-5`}>
          <div className="mb-4 flex items-center gap-2">
            <h2 className="text-[15px] font-bold text-[var(--ink-900)]">{t("inviteMembersTitle")}</h2>
            <HintBadge
              ariaLabel={t("inviteMembersHintAria")}
              title={t("inviteMembersTitle")}
              items={[t("inviteMembersHint")]}
            />
          </div>

          <InviteMemberForm teamId={team.id} />

          <div className="mt-5">
            <div data-testid="invite-pending-heading" className="mb-2 text-[13px] font-semibold text-[var(--ink-900)]">
              {t("sentPendingHeading", { count: pendingSent.length })}
            </div>
            {pendingSent.map(({ invite, invitee }) => (
              // 窄屏（375px）允许换行：标签 / 头像 / 用户名 / UID / 时间 / 撤销
              // 一行放不下时折行，而不是把页面撑出横向滚动。
              <div
                key={invite.id}
                className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1.5 border-t border-[#eceef0] py-2.5 first:border-t-0"
              >
                <Badge
                  variant="info"
                  className="rounded-[var(--radius-pill)] px-2 py-0 text-[12px] font-medium leading-5"
                >
                  {t("pendingTag")}
                </Badge>
                <UserAvatar userId={invitee.id} name={displayName(invitee)} />
                <span className="text-[13px] font-medium text-[var(--ink-900)]">{displayName(invitee)}</span>
                <span className="font-mono text-[12px] text-[var(--ink-400)]">{invitee.uid}</span>
                <span className="ml-auto text-[12px] text-[var(--ink-400)]">
                  {t("sentAtLine", { time: dayjs(invite.createdAt).format("MM-DD HH:mm") })}
                </span>
                <RescindInviteButton inviteId={invite.id} teamId={team.id} />
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {canManage && joinSettings ? (
        <section className={`mb-5 ${CARD_SHELL} p-5`}>
          <div className="mb-4 flex items-center gap-2">
            <h2 className="text-[15px] font-bold text-[var(--ink-900)]">{t("joinByCode")}</h2>
            <HintBadge
              ariaLabel={t("joinCodeSectionHintAria")}
              title={t("joinByCode")}
              items={[t("joinCodeSectionHint")]}
            />
          </div>

          <JoinCodeSettings
            teamId={team.id}
            joinCode={joinSettings.joinCode}
            joinCodeEnabled={joinSettings.joinCodeEnabled}
          />
        </section>
      ) : null}

      {canManage ? (
        <section className={`mb-5 ${CARD_SHELL} p-5`}>
          <h2 className="mb-4 text-[15px] font-bold text-[var(--ink-900)]">
            {t("joinRequestsHeading", { count: joinRequests.length })}
          </h2>

          <JoinRequestList teamId={team.id} requests={joinRequests} />
        </section>
      ) : null}

      <section className={`${CARD_SHELL} p-5`}>
        <h2 className="mb-4 text-[15px] font-bold text-[var(--ink-900)]">{t("membersHeading", { count: members.length })}</h2>
        <MemberList
          members={members}
          teamSlug={team.slug}
          canManage={canRemoveMember}
          currentUserId={user.id}
        />
      </section>

      <section className={`mt-5 ${CARD_SHELL} p-5`}>
        <h2 className="mb-2 text-[15px] font-bold text-[var(--status-overdue)]">{t("dangerZoneTitle")}</h2>

        {canLeave ? (
          <div className="flex items-center gap-4 py-3">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 text-[14px] font-semibold text-[var(--ink-900)]">
                {t("leaveTeam")}
                <HintBadge
                  ariaLabel={t("leaveTeamHintAria")}
                  title={t("leaveTeam")}
                  items={[t("leaveTeamDesc")]}
                />
              </div>
            </div>
            <div className="flex-none">
              <LeaveTeamButton teamSlug={team.slug} />
            </div>
          </div>
        ) : null}

        {canTransfer ? (
          <div className={canLeave ? "flex items-center gap-4 border-t border-[var(--border-default)] py-3" : "flex items-center gap-4 py-3"}>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 text-[14px] font-semibold text-[var(--ink-900)]">
                {t("transferTeam")}
                <HintBadge
                  ariaLabel={t("transferTeamHintAria")}
                  title={t("transferTeam")}
                  items={[t("transferTeamDesc")]}
                />
              </div>
            </div>
            <div className="flex-none">
              <TransferTeamButton teamSlug={team.slug} candidates={transferCandidates} />
            </div>
          </div>
        ) : null}

        {canDissolve ? (
          <div className="flex items-center gap-4 border-t border-[var(--border-default)] py-3">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 text-[14px] font-semibold text-[var(--ink-900)]">
                {t("dissolveTeam")}
                <HintBadge
                  ariaLabel={t("dissolveTeamHintAria")}
                  title={t("dissolveTeam")}
                  items={[t("dissolveTeamDesc")]}
                />
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
