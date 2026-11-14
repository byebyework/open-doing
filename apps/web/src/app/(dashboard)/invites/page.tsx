import { displayName } from "@open-doing/types";
import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";

import { CARD_SHELL } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/EmptyState";
import { PageHeader } from "@/components/ui/PageHeader";
import { UserAvatar } from "@/components/ui/UserAvatar";
import { Badge } from "@/components/ui/shadcn/badge";
import { requireUser } from "@/features/auth/session";
import { formatTaskTimestamp } from "@/lib/date-display";
import { listReceivedInvites } from "@/features/teams/invites/service";
import { InviteRespondButtons } from "@/features/teams/invites/components/InviteRespondButtons";
import { CancelJoinRequestButton } from "@/features/teams/joins/components/CancelJoinRequestButton";
import { listMyJoinRequests } from "@/features/teams/joins/service";
import { joinTeamHref } from "@/lib/routes";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("meta");

  return { title: t("invitesTitle") };
}

/** 邀请结果 tag key + Badge 变体（已处理分区；颜色取 tokens.css 状态色组）。 */
const RESULT_KEYS = {
  accepted: { labelKey: "tagAccepted", variant: "success" },
  declined: { labelKey: "tagDeclined", variant: "neutral" },
} as const;

/** 「我的加入申请」结果 tag key + Badge 变体（已处理项）。 */
const JOIN_RESULT_KEYS = {
  approved: { labelKey: "tagApproved", variant: "success" },
  declined: { labelKey: "tagNotApproved", variant: "neutral" },
  cancelled: { labelKey: "tagCancelled", variant: "neutral" },
} as const;

/**
 * 待处理邀请页（重设计 2026-11-15，对照 invites-v2.html 原型）：
 *
 * - Doing ID 紫色横幅移除（侧栏用户条已有 UID），UID 收敛为页尾小字
 *   （`account-uid` testid 保留——4 个 e2e flow 依赖它读取 guest UID）；
 * - 邀请卡带成员头像栈（listReceivedInvites 新增 memberAvatars）；
 * - 「已处理记录」折叠分组：邀请历史 + 已出结果的加入申请合并为一张表
 *   （`<details>` 原生折叠，默认收起）；
 * - 全空时单一空状态 + 「凭码加入团队」CTA。
 */
export default async function InvitesPage() {
  const user = await requireUser();
  const t = await getTranslations("teams");
  const [received, myJoinRequests] = await Promise.all([
    listReceivedInvites(user.id),
    listMyJoinRequests(user.id),
  ]);

  const pending = received.filter((view) => view.invite.status === "pending");
  const resolvedInvites = received.filter(
    (view) => view.invite.status === "accepted" || view.invite.status === "declined",
  );
  const pendingJoin = myJoinRequests.filter(({ request }) => request.status === "pending");
  const resolvedJoin = myJoinRequests.filter(({ request }) => request.status !== "pending");

  // 已处理记录（邀请 + 加入申请合并，按时间倒序）。
  const historyRows = [
    ...resolvedInvites.map(({ invite, team }) => ({
      key: invite.id,
      teamName: team.name,
      typeKey: "typeInvite" as const,
      result: RESULT_KEYS[invite.status as "accepted" | "declined"],
      time: invite.respondedAt ?? invite.createdAt,
    })),
    ...resolvedJoin.map(({ request, team }) => ({
      key: request.id,
      teamName: team.name,
      typeKey: "typeJoin" as const,
      result: JOIN_RESULT_KEYS[request.status as keyof typeof JOIN_RESULT_KEYS],
      time: request.respondedAt ?? request.createdAt,
    })),
  ].sort((a, b) => String(b.time).localeCompare(String(a.time)));

  const everythingEmpty = received.length === 0 && myJoinRequests.length === 0;

  return (
    <div className="mx-auto w-full max-w-[820px] py-8 min-[861px]:py-10">
      <PageHeader className="mb-6" title={t("invitesTitle")} subtitle={t("invitesSubtitle")} />

      {everythingEmpty ? (
        <EmptyState
          title={t("emptyTitle")}
          description={t("emptyDesc")}
          action={
            <Link href={joinTeamHref()} className="bg-gradient-to-r from-[#7d2ae8] to-[#00c4cc] font-semibold text-white no-underline shadow-[var(--shadow-btn)] transition-shadow hover:shadow-[var(--shadow-btn-hover)] rounded-[var(--radius)] inline-flex items-center justify-center gap-2 px-4 h-9 text-[14px]">
              {t("joinPageTitle")}
            </Link>
          }
        />
      ) : null}

      {received.length > 0 ? (
        <>
          <h2 className="mb-3 text-[15px] font-bold text-[var(--ink-900)]">
            {t("pendingCount", { count: pending.length })}
          </h2>
          {pending.length === 0 ? (
            <p className="mb-6 text-[13px] text-[var(--ink-400)]">{t("noPendingInvites")}</p>
          ) : (
            <div className="mb-6 flex flex-col gap-3">
              {pending.map(({ invite, team, invitedBy, memberCount, memberAvatars }) => (
                <div
                  key={invite.id}
                  className={`flex items-center gap-3 ${CARD_SHELL} p-4`}
                >
                  <span className="grid h-9 w-9 shrink-0 place-items-center rounded-[10px] bg-[rgba(125,42,232,0.12)] text-[14px] font-bold text-[var(--purple-600)]">
                    {team.name.slice(0, 1)}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[14px] font-bold text-[var(--ink-900)]">{team.name}</div>
                    <div className="mt-1 flex min-w-0 flex-wrap items-center gap-2 text-[12px] text-[var(--ink-400)]">
                      <span>{t("inviter")}</span>
                      <UserAvatar
                        userId={invitedBy.id}
                        name={displayName(invitedBy)}
                        size={20}
                      />
                      <span className="text-[var(--ink-500)]">{displayName(invitedBy)}</span>
                      <span className="font-mono">{invitedBy.uid}</span>
                      {/* 成员头像栈（+N 溢出）：比纯文字成员数直观 */}
                      <span className="avatar-stack">
                        {memberAvatars.map((member) => (
                          <UserAvatar
                            key={member.userId}
                            userId={member.userId}
                            name={member.name}
                            size={20}
                          />
                        ))}
                        {memberCount > memberAvatars.length ? (
                          <span className="grid h-5 w-5 place-items-center rounded-full border border-[var(--border-default)] bg-[var(--card)] text-[9px] font-bold text-[var(--muted-foreground)]">
                            +{Number(memberCount) - memberAvatars.length}
                          </span>
                        ) : null}
                      </span>
                      <span>{t("teamMemberCount", { count: memberCount })}</span>
                      <span>{formatTaskTimestamp(invite.createdAt)}</span>
                    </div>
                  </div>
                  <InviteRespondButtons inviteId={invite.id} />
                </div>
              ))}
            </div>
          )}
        </>
      ) : null}

      {myJoinRequests.length > 0 ? (
        <>
          <h2 className="mb-3 text-[15px] font-bold text-[var(--ink-900)]">
            {t("myJoinRequests", { count: myJoinRequests.length })}
          </h2>
          {pendingJoin.length > 0 ? (
            <div className="mb-6 flex flex-col gap-3">
              {pendingJoin.map(({ request, team }) => (
                <div
                  key={request.id}
                  className={`flex items-center gap-3 ${CARD_SHELL} p-4`}
                >
                  <span className="grid h-9 w-9 shrink-0 place-items-center rounded-[10px] bg-[rgba(125,42,232,0.12)] text-[14px] font-bold text-[var(--purple-600)]">
                    {team.name.slice(0, 1)}
                  </span>
                  <div className="min-w-0 flex-1">
                    {/* 申请人此时还不是成员，团队空间会 404，故只展示团队名。 */}
                    <div className="truncate text-[14px] font-bold text-[var(--ink-900)]">
                      {team.name}
                    </div>
                    <div className="mt-0.5 text-[12px] text-[var(--ink-400)]">
                      {t("requestedAt", {
                        time: formatTaskTimestamp(request.createdAt),
                      })}
                    </div>
                  </div>
                  <CancelJoinRequestButton requestId={request.id} teamName={team.name} />
                </div>
              ))}
            </div>
          ) : null}
        </>
      ) : null}

      {historyRows.length > 0 ? (
        // 已处理记录默认折叠（原生 <details>，无 JS）；e2e 断言前先展开。
        <details>
          <summary className="flex cursor-pointer items-center gap-2 rounded-lg border border-[var(--border-default)] bg-white px-3 py-2 text-[13px] font-semibold text-[var(--ink-700)] transition-colors hover:bg-[var(--muted)] [&::-webkit-details-marker]:hidden">
            {t("historyGroup")}
            <span className="ml-auto text-[12px] font-normal text-[var(--ink-400)]">
              {t("historyCount", {
                invites: resolvedInvites.length,
                joins: resolvedJoin.length,
              })}
            </span>
          </summary>
          <div className="pt-3">
            <table className="w-full border-collapse text-[13px]">
              <thead>
                <tr className="text-left text-[var(--ink-400)]">
                  <th className="pb-2 font-medium">{t("tableTeam")}</th>
                  <th className="pb-2 font-medium">{t("tableType")}</th>
                  <th className="pb-2 font-medium">{t("tableResultTime")}</th>
                </tr>
              </thead>
              <tbody>
                {historyRows.map((row) => (
                  <tr key={row.key} className="border-t border-[#eceef0]">
                    <td className="py-2.5 font-medium text-[var(--ink-900)]">{row.teamName}</td>
                    <td className="py-2.5">
                      <Badge variant="neutral">{t(row.typeKey)}</Badge>
                    </td>
                    <td className="py-2.5">
                      <span className="flex items-center gap-2.5 text-[var(--ink-500)]">
                        <Badge variant={row.result.variant}>{t(row.result.labelKey)}</Badge>
                        {formatTaskTimestamp(row.time)}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      ) : null}

      {/* UID 收敛为页尾小字；account-uid testid 被 4 个 e2e flow 依赖。 */}
      <p className="mt-8 text-[12px] text-[var(--ink-400)]">
        {t("uidCaption")}
        <span className="font-mono" data-testid="account-uid">
          {user.uid}
        </span>
      </p>
    </div>
  );
}
