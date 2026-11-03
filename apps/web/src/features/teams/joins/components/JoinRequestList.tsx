"use client";

import { Loader2Icon } from "lucide-react";
import dayjs from "dayjs";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";

import { ConfirmModal } from "@/components/ui/ConfirmModal";
import { UserAvatar } from "@/components/ui/UserAvatar";
import { Badge } from "@/components/ui/shadcn/badge";
import { Button } from "@/components/ui/shadcn/button";

import { respondToJoinRequestAction } from "../actions";
import type { TeamJoinRequestView } from "../service";

/** 已处理申请的结果 badge 文案 key（与 /invites「我的加入申请」复用同一套 key 与配色）。 */
const RESULT_KEYS = {
  approved: "tagApproved",
  declined: "tagNotApproved",
  cancelled: "tagCancelled",
} as const;

/** 结果 badge 变体（与 /invites 复用；变体取 tokens.css 状态色组，语言无关）。 */
const RESULT_VARIANTS = {
  approved: "success",
  declined: "neutral",
  cancelled: "neutral",
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
        toast.error(
          result.errors.form ?? (approve ? t("approveFailedUi") : t("declineFailedUi")),
        );
        return;
      }

      toast.success(approve ? t("approveDone") : t("declineDone"));
      setDeclining(null);
      router.refresh();
    } catch {
      toast.error(tCommon("networkError"));
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
                size="sm"
                disabled={busy && submittingId !== request.id}
                aria-label={t("approveAria", { name: user.username })}
                onClick={() => respond(request.id, true)}
              >
                {submittingId === request.id ? (
                  <Loader2Icon className="animate-spin" aria-hidden="true" />
                ) : null}
                {t("approve")}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="text-destructive hover:text-destructive"
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
        const resultVariant =
          RESULT_VARIANTS[request.status as keyof typeof RESULT_VARIANTS];
        const time = request.respondedAt ?? request.createdAt;

        return (
          <div
            key={`${teamId}:${request.id}`}
            className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1.5 border-t border-[#eceef0] py-2.5"
          >
            <Badge
              variant={resultVariant}
              className="rounded-[var(--radius-pill)] px-2 py-0 text-[12px] font-medium leading-5"
            >
              {t(resultKey)}
            </Badge>
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
