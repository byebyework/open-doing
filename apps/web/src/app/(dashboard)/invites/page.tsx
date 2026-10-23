import { Tag } from "antd";
import type { Metadata } from "next";
import dayjs from "dayjs";

import { EmptyState } from "@/components/ui/EmptyState";
import { UserAvatar } from "@/components/ui/UserAvatar";
import { requireUser } from "@/features/auth/session";
import { listReceivedInvites } from "@/features/teams/invites/service";
import { InviteRespondButtons } from "@/features/teams/invites/components/InviteRespondButtons";

export const metadata: Metadata = {
  title: "待处理邀请 · Open Doing",
};

/** 邀请结果 tag（已处理分区）。 */
const RESULT_LABELS = {
  accepted: { label: "已接受", color: "#00b894", background: "rgba(0, 184, 148, 0.12)" },
  declined: { label: "已拒绝", color: "#5f6368", background: "#f1f3f4" },
} as const;

/**
 * 待处理邀请页（T-3）：按 UID 收到的团队邀请的接受 / 拒绝与历史记录。
 *
 * 对照 invites.html 原型：待处理卡片 + 已处理表格 + 空状态。
 * 邀请失效（撤销 / 团队解散）时由按钮以 message 提示，不进报错页。
 */
export default async function InvitesPage() {
  const user = await requireUser();
  const received = await listReceivedInvites(user.id);

  const pending = received.filter((view) => view.invite.status === "pending");
  const resolved = received.filter(
    (view) => view.invite.status === "accepted" || view.invite.status === "declined",
  );

  return (
    <div className="mx-auto w-full max-w-[820px] py-8 min-[861px]:py-10">
      <h1 className="text-[22px] font-extrabold tracking-[-0.01em] text-[#0e1318]">待处理邀请</h1>
      <p className="mb-6 mt-1.5 text-[14px] text-[#5f6368]">
        通过 UID 收到的团队邀请，接受后即可参与团队项目。
      </p>

      <div className="mb-6 rounded-lg border border-[#e1e3e6] bg-[rgba(125,42,232,0.06)] p-3.5 text-[13px] text-[#5f6368]">
        <strong className="text-[#0e1318]">邀请基于你的 UID 发送，不会公开用户名</strong>
        ；你可以在侧栏底部随时查看自己的 UID（<span className="font-mono">{user.uid}</span>）。
      </div>

      {received.length === 0 ? (
        <EmptyState
          title="暂无邀请"
          description="把你的 UID 告诉团队管理员，即可被邀请加入团队。"
        />
      ) : (
        <>
          <h2 className="mb-3 text-[15px] font-bold text-[#0e1318]">待处理（{pending.length}）</h2>
          {pending.length === 0 ? (
            <p className="mb-6 text-[13px] text-[#9aa0a6]">没有待处理的邀请。</p>
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
                      <span>邀请人</span>
                      <UserAvatar username={invitedBy.username} size={20} />
                      <span className="text-[#5f6368]">{invitedBy.username}</span>
                      <span className="font-mono">{invitedBy.uid}</span>
                      <span>·</span>
                      <span>团队 {memberCount} 人</span>
                      <span>·</span>
                      <span>{dayjs(invite.createdAt).format("MM-DD HH:mm")}</span>
                    </div>
                  </div>
                  <InviteRespondButtons inviteId={invite.id} />
                </div>
              ))}
            </div>
          )}

          <h2 className="mb-3 text-[15px] font-bold text-[#0e1318]">已处理</h2>
          {resolved.length === 0 ? (
            <p className="text-[13px] text-[#9aa0a6]">暂无历史记录。</p>
          ) : (
            <table className="w-full border-collapse text-[13px]">
              <thead>
                <tr className="text-left text-[#9aa0a6]">
                  <th className="pb-2 font-medium">团队</th>
                  <th className="pb-2 font-medium">结果与时间</th>
                </tr>
              </thead>
              <tbody>
                {resolved.map(({ invite, team }) => {
                  const result = RESULT_LABELS[invite.status as "accepted" | "declined"];
                  const time = invite.respondedAt ?? invite.createdAt;
                  return (
                    <tr key={invite.id} className="border-t border-[#eceef0]">
                      <td className="py-2.5 font-medium text-[#0e1318]">{team.name}</td>
                      <td className="py-2.5">
                        <span className="flex items-center gap-2.5 text-[#5f6368]">
                          <Tag
                            style={{
                              color: result.color,
                              background: result.background,
                              border: "none",
                              borderRadius: 999,
                            }}
                          >
                            {result.label}
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
    </div>
  );
}
