"use client";

import { Button, Input } from "antd";
import { useState } from "react";

import { UserAvatar } from "@/components/ui/UserAvatar";

/** 评论列表项（作者名由服务端组装）。 */
export interface CommentBoxItem {
  id: string;
  authorId: string;
  authorName: string;
  content: string;
  createdAt: string;
}

/** 评论列表 + 输入框入参。 */
export interface CommentBoxProps {
  /** 评论列表（保持调用方给定顺序）。 */
  comments: CommentBoxItem[];
  /** 当前登录用户 ID：仅本人评论显示删除入口。 */
  currentUserId: string;
  /** 发表评论。 */
  onAdd: (content: string) => Promise<void>;
  /** 删除评论；缺省时隐藏删除入口。 */
  onDelete?: (commentId: string) => Promise<void>;
}

/**
 * 评论时间显示为原型同款 `MM-DD HH:mm`。
 *
 * 固定 Asia/Shanghai 时区并手动拼接，避免服务端 / 客户端本地时区不同
 * 造成水合文本不一致。
 */
function formatCommentTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";

  const parts = new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);

  const read = (type: string) =>
    parts.find((part) => part.type === type)?.value ?? "";

  return `${read("month")}-${read("day")} ${read("hour")}:${read("minute")}`;
}

/**
 * 评论列表与发表框（纯展示 + 本地交互态）。
 *
 * 不内置错误提示：异步回调由调用方负责提示失败原因，本组件只维护
 * 提交 / 删除过程中的禁用态，避免重复提交。
 */
export function CommentBox({
  comments,
  currentUserId,
  onAdd,
  onDelete,
}: CommentBoxProps) {
  const [draft, setDraft] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  async function handleSubmit() {
    const content = draft.trim();
    if (!content || submitting) return;

    setSubmitting(true);
    try {
      await onAdd(content);
      setDraft("");
    } catch {
      // 错误提示由调用方负责。
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDelete(commentId: string) {
    if (!onDelete || deletingId) return;

    setDeletingId(commentId);
    try {
      await onDelete(commentId);
    } catch {
      // 错误提示由调用方负责。
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <div>
      {comments.length === 0 ? (
        <p className="py-2 text-[13px] text-[#9aa0a6]">暂无评论</p>
      ) : (
        <div className="flex flex-col gap-5">
          {comments.map((comment) => (
            <div key={comment.id} className="group flex gap-3">
              <UserAvatar username={comment.authorName} size={30} />

              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-[13.5px] font-semibold text-[#0e1318]">
                    {comment.authorName}
                  </span>
                  <span className="text-[12px] text-[#9aa0a6]">
                    {formatCommentTime(comment.createdAt)}
                  </span>

                  {onDelete && comment.authorId === currentUserId ? (
                    <Button
                      type="text"
                      size="small"
                      danger
                      className="ml-auto opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
                      loading={deletingId === comment.id}
                      onClick={() => {
                        void handleDelete(comment.id);
                      }}
                    >
                      删除
                    </Button>
                  ) : null}
                </div>

                <p className="mt-1 whitespace-pre-wrap break-words text-[13.5px] leading-relaxed text-[#3c4043]">
                  {comment.content}
                </p>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="mt-5">
        <Input.TextArea
          value={draft}
          rows={3}
          maxLength={2000}
          aria-label="评论内容"
          showCount
          placeholder="写下你的评论…"
          disabled={submitting}
          onChange={(event) => setDraft(event.target.value)}
        />

        <div className="mt-2.5 flex justify-end gap-2">
          <Button
            disabled={submitting || draft.length === 0}
            onClick={() => setDraft("")}
          >
            取消
          </Button>
          <Button
            type="primary"
            loading={submitting}
            disabled={!draft.trim()}
            onClick={() => {
              void handleSubmit();
            }}
          >
            发表评论
          </Button>
        </div>
      </div>
    </div>
  );
}
