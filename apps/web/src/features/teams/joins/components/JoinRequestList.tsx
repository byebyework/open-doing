"use client";

import { Button, message, Tag } from "antd";
import dayjs from "dayjs";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { ConfirmModal } from "@/components/ui/ConfirmModal";
import { UserAvatar } from "@/components/ui/UserAvatar";

import { respondToJoinRequestAction } from "../actions";
import type { TeamJoinRequestView } from "../service";

/** 已处理申请的结果 tag（与 /invites「我的加入申请」复用同一套文案与配色）。 */
const RESULT_LABELS = {
  approved: { label: "已通过", color: "#00b894", background: "rgba(0, 184, 148, 0.12)" },
  declined: { label: "未通过", color: "#5f6368", background: "#f1f3f4" },
  cancelled: { label: "已取消", color: "#5f6368", background: "#f1f3f4" },
} as const;

export interface JoinRequestListProps {
  teamId: string;
  /** 团队全部加入申请（全状态，createdAt 升序）。 */
  requests: TeamJoinRequestView[];
}

/**
 * 加入申请队列（客户端交互层）：待处理逐条通过/拒绝，已处理只读展示结果。
 *
 * 「通过」直接调 action；「拒绝」走 ConfirmModal 二次确认。同一时刻只允许
 * 一条申请在提交中，其余按钮禁用，避免重复/并发提交。
 */
export function JoinRequestList({ teamId, requests }: JoinRequestListProps) {
  const router = useRouter();
  const [submittingId, setSubmittingId] = useState<string | null>(null);
  const [declining, setDeclining] = useState<TeamJoinRequestView | null>(null);

  const pending = requests.filter(({ request }) => request.status === "pending");
  const processed = requests.filter(({ request }) => request.status !== "pending");
  const busy = submittingId !== null;

  async function respond(requestId: string, approve: boolean) {
    setSubmittingId(requestId);

    try {
      const result = await respondToJoinRequestAction({ requestId, approve });

      if (!result.ok) {
        message.error(
          result.errors.form ??
            (approve ? "通过加入申请失败，请稍后重试" : "拒绝加入申请失败，请稍后重试"),
        );
        return;
      }

      message.success(approve ? "已通过加入申请" : "已拒绝加入申请");
      setDeclining(null);
      router.refresh();
    } catch {
      message.error("网络异常，请稍后重试");
    } finally {
      setSubmittingId(null);
    }
  }

  return (
    <div className="min-w-0">
      {pending.length === 0 ? (
        <p className="text-[13px] text-[#9aa0a6]">暂无待处理的加入申请</p>
      ) : (
        pending.map(({ request, user }) => (
          // 窄屏（375px）允许换行：头像 / 用户名 / UID / 时间 / 操作折行，
          // 而不是把页面撑出横向滚动。
          <div
            key={`${teamId}:${request.id}`}
            className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1.5 border-t border-[#eceef0] py-2.5 first:border-t-0"
          >
            <UserAvatar username={user.username} />
            <span className="max-w-[180px] truncate text-[13px] font-medium text-[#0e1318]">
              {user.username}
            </span>
            <span className="max-w-[160px] truncate font-mono text-[12px] text-[#9aa0a6]">
              {user.uid}
            </span>
            <span className="ml-auto text-[12px] text-[#9aa0a6]">
              {dayjs(request.createdAt).format("MM-DD HH:mm")} 申请
            </span>
            <span className="flex flex-none items-center gap-1.5">
              <Button
                type="primary"
                size="small"
                loading={submittingId === request.id}
                disabled={busy && submittingId !== request.id}
                aria-label={`通过 ${user.username} 的加入申请`}
                onClick={() => respond(request.id, true)}
              >
                通过
              </Button>
              <Button
                type="text"
                danger
                size="small"
                disabled={busy}
                aria-label={`拒绝 ${user.username} 的加入申请`}
                onClick={() => setDeclining({ request, user })}
              >
                拒绝
              </Button>
            </span>
          </div>
        ))
      )}

      {processed.map(({ request, user }) => {
        const result = RESULT_LABELS[request.status as keyof typeof RESULT_LABELS];
        const time = request.respondedAt ?? request.createdAt;

        return (
          <div
            key={`${teamId}:${request.id}`}
            className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1.5 border-t border-[#eceef0] py-2.5"
          >
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
            <UserAvatar username={user.username} />
            <span className="max-w-[180px] truncate text-[13px] font-medium text-[#0e1318]">
              {user.username}
            </span>
            <span className="max-w-[160px] truncate font-mono text-[12px] text-[#9aa0a6]">
              {user.uid}
            </span>
            <span className="ml-auto text-[12px] text-[#9aa0a6]">
              {dayjs(time).format("MM-DD HH:mm")}
            </span>
          </div>
        );
      })}

      <ConfirmModal
        open={declining !== null}
        title="拒绝加入申请"
        content={
          declining
            ? `确定拒绝「${declining.user.username}」的加入申请吗？对方将收到未通过的通知。`
            : null
        }
        confirmText="拒绝"
        danger
        loading={declining !== null && submittingId === declining.request.id}
        onConfirm={() => {
          if (declining) void respond(declining.request.id, false);
        }}
        onCancel={() => setDeclining(null)}
      />
    </div>
  );
}
