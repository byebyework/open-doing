import { Tag } from "antd";
import type { Metadata } from "next";
import Link from "next/link";
import dayjs from "dayjs";
import { getTranslations } from "next-intl/server";

import { EmptyState } from "@/components/ui/EmptyState";
import { UserAvatar } from "@/components/ui/UserAvatar";
import { requireUser } from "@/features/auth/session";
import { listReceivedInvites } from "@/features/teams/invites/service";
import { InviteRespondButtons } from "@/features/teams/invites/components/InviteRespondButtons";
import { CancelJoinRequestButton } from "@/features/teams/joins/components/CancelJoinRequestButton";
import { listMyJoinRequests } from "@/features/teams/joins/service";
import { joinTeamHref } from "@/lib/routes";

export const metadata: Metadata = {
  title: "待处理邀请 · Open Doing",
};

/** 邀请结果 tag key（已处理分区）。 */
const RESULT_KEYS = {
  accepted: "tagAccepted",
  declined: "tagDeclined",
} as const;

/** 邀请结果 tag 配色（key 与文案分离，配色与语言无关）。 */
const RESULT_COLORS = {
  accepted: { color: "#00b894", background: "rgba(0, 184, 148, 0.12)" },
  declined: { color: "#5f6368", background: "#f1f3f4" },
} as const;

/** 「我的加入申请」结果 tag key（已处理项）。 */
const JOIN_RESULT_KEYS = {
  approved: "tagApproved",
  declined: "tagNotApproved",
  cancelled: "tagCancelled",
} as const;

/** 加入申请结果 tag 配色。 */
const JOIN_RESULT_COLORS = {
  approved: { color: "#00b894", background: "rgba(0, 184, 148, 0.12)" },
  declined: { color: "#5f6368", background: "#f1f3f4" },
  cancelled: { color: "#5f6368", background: "#f1f3f4" },
} as const;

/**
 * 待处理邀请页（T-3）：按 UID 收到的团队邀请的接受 / 拒绝与历史记录。
 *
 * 对照 invites.html 原型：待处理卡片 + 已处理表格 + 空状态。
 * 邀请失效（撤销 / 团队解散）时由按钮以 message 提示，不进报错页。
 */
export default async function InvitesPage() {
  const user = await requireUser();
  const t = await getTranslations("teams");
  const [received, myJoinRequests] = await Promise.all([
    listReceivedInvites(user.id),
    listMyJoinRequests(user.id),
  ]);

  const pending = received.filter((view) => view.invite.status === "pending");
  const resolved = received.filter(
    (view) => view.invite.status === "accepted" || view.invite.status === "declined",
  );

  const pendingJoin = myJoinRequests.filter(({ request }) => request.status === "pending");
  const resolvedJoin = myJoinRequests.filter(({ request }) => request.status !== "pending");

  return (
    <div className="mx-auto w-full max-w-[820px] py-8 min-[861px]:py-10">
      <h1 className="text-[22px] font-extrabold tracking-[-0.01em] text-[#0e1318]">{t("invitesTitle")}</h1>
      <p className="mb-6 mt-1.5 text-[14px] text-[#5f6368]">
        {t("invitesSubtitle")}
      </p>

      <div className="mb-6 rounded-lg border border-[#e1e3e6] bg-[rgba(125,42,232,0.06)] p-3.5 text-[13px] text-[#5f6368]">
        <strong className="text-[#0e1318]">{t("uidPrivacyStrong")}</strong>
        {t("uidPrivacyYour")} <span className="font-mono">{user.uid}</span>。
      </div>

      {received.length === 0 ? (
        <EmptyState
          title={t("noInvites")}
          description={t("noInvitesHint")}
        />
      ) : (
        <>
          <h2 className="mb-3 text-[15px] font-bold text-[#0e1318]">{t("pendingCount", { count: pending.length })}</h2>
          {pending.length === 0 ? (
            <p className="mb-6 text-[13px] text-[#9aa0a6]">{t("noPendingInvites")}</p>
          ) : (
            <div className="mb-6 flex flex-col gap-3">
              {pending.map(({ invite, team, invitedBy, memberCount }) => (
                <div
                  key={invite.id}
                  className="flex items-center gap-3 rounded-xl border border-[#e1e3e6] bg-white p-4 shadow-[0_1px_3px_rgba(14,19,24,0.04)]"
                >
                  <span className="grid h-9 w-9 shrink-0 place-items-center rounded-[10px] bg-[rgba(125,42,232,0.12)] text-[14px] font-bold text-[#7d2ae8]">
                    {team.name.slice(0, 1)}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[14px] font-bold text-[#0e1318]">{team.name}</div>
                    <div className="mt-0.5 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 text-[12px] text-[#9aa0a6]">
                      <span>{t("inviter")}</span>
                      <UserAvatar username={invitedBy.username} size={20} />
                      <span className="text-[#5f6368]">{invitedBy.username}</span>
                      <span className="font-mono">{invitedBy.uid}</span>
                      <span>·</span>
                      <span>{t("teamMemberCount", { count: memberCount })}</span>
                      <span>·</span>
                      <span>{dayjs(invite.createdAt).format("MM-DD HH:mm")}</span>
                    </div>
                  </div>
                  <InviteRespondButtons inviteId={invite.id} />
                </div>
              ))}
            </div>
          )}

          <h2 className="mb-3 text-[15px] font-bold text-[#0e1318]">{t("processed")}</h2>
          {resolved.length === 0 ? (
            <p className="text-[13px] text-[#9aa0a6]">{t("noHistory")}</p>
          ) : (
            <table className="w-full border-collapse text-[13px]">
              <thead>
                <tr className="text-left text-[#9aa0a6]">
                  <th className="pb-2 font-medium">{t("tableTeam")}</th>
                  <th className="pb-2 font-medium">{t("tableResultTime")}</th>
                </tr>
              </thead>
              <tbody>
                {resolved.map(({ invite, team }) => {
                  const resultKey = RESULT_KEYS[invite.status as "accepted" | "declined"];
                  const resultColor = RESULT_COLORS[invite.status as "accepted" | "declined"];
                  const time = invite.respondedAt ?? invite.createdAt;
                  return (
                    <tr key={invite.id} className="border-t border-[#eceef0]">
                      <td className="py-2.5 font-medium text-[#0e1318]">{team.name}</td>
                      <td className="py-2.5">
                        <span className="flex items-center gap-2.5 text-[#5f6368]">
                          <Tag
                            style={{
                              color: resultColor.color,
                              background: resultColor.background,
                              border: "none",
                              borderRadius: 999,
                            }}
                          >
                            {t(resultKey)}
                          </Tag>
                          {dayjs(time).format("MM-DD")}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </>
      )}

      <h2 className="mb-3 mt-8 text-[15px] font-bold text-[#0e1318]">
        {t("myJoinRequests", { count: myJoinRequests.length })}
      </h2>
      {myJoinRequests.length === 0 ? (
        <p className="text-[13px] text-[#9aa0a6]">
          {t("noJoinRequestsBefore")}{" "}
          <Link href={joinTeamHref()} className="font-semibold text-[#7d2ae8]">
            {t("joinPageTitle")}
          </Link>{" "}
          {t("noJoinRequestsAfter")}
        </p>
      ) : (
        <>
          {pendingJoin.length > 0 ? (
            <div className="mb-6 flex flex-col gap-3">
              {pendingJoin.map(({ request, team }) => (
                <div
                  key={request.id}
                  className="flex items-center gap-3 rounded-xl border border-[#e1e3e6] bg-white p-4 shadow-[0_1px_3px_rgba(14,19,24,0.04)]"
                >
                  <span className="grid h-9 w-9 shrink-0 place-items-center rounded-[10px] bg-[rgba(125,42,232,0.12)] text-[14px] font-bold text-[#7d2ae8]">
                    {team.name.slice(0, 1)}
                  </span>
                  <div className="min-w-0 flex-1">
                    {/* 申请人此时还不是成员，团队空间会 404，故只展示团队名。 */}
                    <div className="truncate text-[14px] font-bold text-[#0e1318]">
                      {team.name}
                    </div>
                    <div className="mt-0.5 text-[12px] text-[#9aa0a6]">
                      {t("requestedAt", {
                        time: dayjs(request.createdAt).format("MM-DD HH:mm"),
                      })}
                    </div>
                  </div>
                  <CancelJoinRequestButton requestId={request.id} teamName={team.name} />
                </div>
              ))}
            </div>
          ) : null}

          {resolvedJoin.length > 0 ? (
            <table className="w-full border-collapse text-[13px]">
              <thead>
                <tr className="text-left text-[#9aa0a6]">
                  <th className="pb-2 font-medium">{t("tableTeam")}</th>
                  <th className="pb-2 font-medium">{t("tableResultTime")}</th>
                </tr>
              </thead>
              <tbody>
                {resolvedJoin.map(({ request, team }) => {
                  const resultKey =
                    JOIN_RESULT_KEYS[
                      request.status as keyof typeof JOIN_RESULT_KEYS
                    ];
                  const resultColor =
                    JOIN_RESULT_COLORS[
                      request.status as keyof typeof JOIN_RESULT_COLORS
                    ];
                  const time = request.respondedAt ?? request.createdAt;
                  return (
                    <tr key={request.id} className="border-t border-[#eceef0]">
                      <td className="py-2.5 font-medium text-[#0e1318]">{team.name}</td>
                      <td className="py-2.5">
                        <span className="flex items-center gap-2.5 text-[#5f6368]">
                          <Tag
                            style={{
                              color: resultColor.color,
                              background: resultColor.background,
                              border: "none",
                              borderRadius: 999,
                            }}
                          >
                            {t(resultKey)}
                          </Tag>
                          {dayjs(time).format("MM-DD HH:mm")}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          ) : null}
        </>
      )}
    </div>
  );
}
