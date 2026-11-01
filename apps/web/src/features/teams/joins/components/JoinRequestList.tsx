"use client";

import { Button, message, Tag } from "antd";
import dayjs from "dayjs";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";

import { ConfirmModal } from "@/components/ui/ConfirmModal";
import { UserAvatar } from "@/components/ui/UserAvatar";

import { respondToJoinRequestAction } from "../actions";
import type { TeamJoinRequestView } from "../service";

/** 已处理申请的结果 tag key（与 /invites「我的加入申请」复用同一套 key 与配色）。 */
const RESULT_KEYS = {
  approved: "tagApproved",
  declined: "tagNotApproved",
  cancelled: "tagCancelled",
} as const;

/** 结果 tag 配色（与 /invites 复用；配色与语言无关）。 */
const RESULT_COLORS = {
  approved: { color: "#00b894", background: "rgba(0, 184, 148, 0.12)" },
  declined: { color: "#5f6368", background: "#f1f3f4" },
  cancelled: { color: "#5f6368", background: "#f1f3f4" },
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
  const t = useTranslations("teams");
  const tCommon = useTranslations("common");
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
          result.errors.form ?? (approve ? t("approveFailedUi") : t("declineFailedUi")),
        );
        return;
      }

      message.success(approve ? t("approveDone") : t("declineDone"));
      setDeclining(null);
      router.refresh();
    } catch {
      message.error(tCommon("networkError"));
    } finally {
      setSubmittingId(null);
    }
  }

  return (
    <div className="min-w-0">
      {pending.length === 0 ? (
        <p className="text-[13px] text-[#9aa0a6]">{t("noPendingJoinRequests")}</p>
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
              {t("requestedAtSuffix", { time: dayjs(request.createdAt).format("MM-DD HH:mm") })}
            </span>
            <span className="flex flex-none items-center gap-1.5">
              <Button
                type="primary"
                size="small"
                loading={submittingId === request.id}
                disabled={busy && submittingId !== request.id}
                aria-label={t("approveAria", { name: user.username })}
                onClick={() => respond(request.id, true)}
              >
                {t("approve")}
              </Button>
              <Button
                type="text"
                danger
                size="small"
                disabled={busy}
                aria-label={t("declineAria", { name: user.username })}
                onClick={() => setDeclining({ request, user })}
              >
                {t("decline")}
              </Button>
            </span>
          </div>
        ))
      )}

      {processed.map(({ request, user }) => {
        const resultKey =
          RESULT_KEYS[request.status as keyof typeof RESULT_KEYS];
        const resultColor =
          RESULT_COLORS[request.status as keyof typeof RESULT_COLORS];
        const time = request.respondedAt ?? request.createdAt;

        return (
          <div
            key={`${teamId}:${request.id}`}
            className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1.5 border-t border-[#eceef0] py-2.5"
          >
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
        title={t("declineJoinTitle")}
        content={
          declining
            ? t("declineJoinConfirm", { name: declining.user.username })
            : null
        }
        confirmText={t("decline")}
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
