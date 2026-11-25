"use client";

import {
  CalendarIcon,
  CircleDotIcon,
  DiamondIcon,
  FileTextIcon,
  Loader2Icon,
  MessageCircleIcon,
  SignalIcon,
  SparklesIcon,
  TagIcon,
  UserIcon,
  UsersIcon,
  type LucideIcon,
} from "lucide-react";
import { motion } from "motion/react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useState } from "react";

import type { ProjectActivityType, ProjectStatus, TaskPriority } from "@open-doing/types";

import { CharCounter } from "@/components/ui/CharCounter";
import { UserAvatar } from "@/components/ui/UserAvatar";
import { Button } from "@/components/ui/shadcn/button";
import { Textarea } from "@/components/ui/shadcn/textarea";
import { COMMENT_MAX_LENGTH } from "@/lib/task-fields";
import { formatTaskTimestamp } from "@/lib/date-display";
import { toast } from "sonner";

import { addProjectCommentAction, deleteProjectCommentAction } from "../actions";
import type { TimelineItem } from "../activities";

export interface ProjectTimelineProps {
  projectId: string;
  /** RSC 组装的时间线（动态 + 评论，createdAt 倒序）。 */
  items: TimelineItem[];
  /** 当前用户：仅本人评论显示删除入口。 */
  currentUserId: string;
}

/** 动态类型 → 行首图标（稀疏单图标，对照 Linear 行密度）。 */
const TYPE_ICON: Record<ProjectActivityType, LucideIcon> = {
  created: SparklesIcon,
  name: FileTextIcon,
  summary: FileTextIcon,
  description: FileTextIcon,
  status: CircleDotIcon,
  priority: SignalIcon,
  start_date: CalendarIcon,
  end_date: CalendarIcon,
  lead: UserIcon,
  members: UsersIcon,
  tags: TagIcon,
  milestone_added: DiamondIcon,
  milestone_removed: DiamondIcon,
  milestone_updated: DiamondIcon,
};

const STATUS_LABEL_KEY = {
  backlog: "statusBacklog",
  planned: "statusPlanned",
  in_progress: "statusInProgress",
  completed: "statusCompleted",
  canceled: "statusCanceled",
} as const satisfies Record<ProjectStatus, string>;

const PRIORITY_LABEL_KEY = {
  low: "priorityLow",
  medium: "priorityMedium",
  high: "priorityHigh",
} as const satisfies Record<TaskPriority, string>;

const MILESTONE_FIELD_LABEL_KEY = {
  name: "activityMilestoneFieldName",
  dueDate: "activityMilestoneFieldDueDate",
  description: "activityMilestoneFieldDescription",
} as const;

/** 行进入动效：0.18s easeOut + 30ms 级联（MotionConfig reducedMotion 兜底）。 */
const ROW_TRANSITION = { duration: 0.18, ease: "easeOut" as const };
const ROW_STAGGER = 0.03;
const ROW_STAGGER_CAP = 0.3;

/**
 * 项目动态时间线：编辑动态与评论同流（createdAt 倒序），顶部评论输入区。
 * 动态只读（无删除入口）；评论仅作者本人可删。文案全部走 projects 命名空间。
 */
export function ProjectTimeline({
  projectId,
  items,
  currentUserId,
}: ProjectTimelineProps) {
  const t = useTranslations("projects");
  const tCommon = useTranslations("common");
  const router = useRouter();
  const [draft, setDraft] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  // 线程收展：Set 存已展开的根评论 id；组件本地态，不进 URL（重挂回默认收起）。
  // 草稿按根评论分区——多线程可同时展开，共享草稿会串台/互清。
  const [expandedThreads, setExpandedThreads] = useState<Set<string>>(new Set());
  const [replyDrafts, setReplyDrafts] = useState<Record<string, string>>({});
  const [replySubmittingRoot, setReplySubmittingRoot] = useState<string | null>(null);

  function toggleThread(rootId: string) {
    // 收展不清草稿：误点 pill 不丢已输入的回复。
    setExpandedThreads((current) => {
      const next = new Set(current);
      if (next.has(rootId)) next.delete(rootId);
      else next.add(rootId);
      return next;
    });
  }

  function setThreadDraft(rootId: string, value: string) {
    setReplyDrafts((current) => ({ ...current, [rootId]: value }));
  }

  function clearThreadDraft(rootId: string) {
    setReplyDrafts((current) => {
      const next = { ...current };
      delete next[rootId];
      return next;
    });
  }

  async function handleReplySubmit(rootId: string) {
    const content = (replyDrafts[rootId] ?? "").trim();
    if (!content || replySubmittingRoot) return;

    setReplySubmittingRoot(rootId);
    try {
      const result = await addProjectCommentAction({
        projectId,
        content,
        parentId: rootId,
      });
      if (!result.ok) {
        toast.error(result.errors.content ?? result.errors.form);
        return;
      }
      // 发完保持展开：用户正处在该线程的对话里。
      clearThreadDraft(rootId);
      router.refresh();
    } catch {
      toast.error(tCommon("networkError"));
    } finally {
      setReplySubmittingRoot(null);
    }
  }

  async function handleSubmit() {
    const content = draft.trim();
    if (!content || submitting) return;

    setSubmitting(true);
    try {
      const result = await addProjectCommentAction({ projectId, content });
      if (!result.ok) {
        toast.error(result.errors.content ?? result.errors.form);
        return;
      }
      setDraft("");
      router.refresh();
    } catch {
      toast.error(tCommon("networkError"));
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDelete(commentId: string) {
    if (deletingId) return;

    setDeletingId(commentId);
    try {
      const result = await deleteProjectCommentAction({ projectId, commentId });
      if (!result.ok) {
        toast.error(result.errors.form);
        return;
      }
      router.refresh();
    } catch {
      toast.error(tCommon("networkError"));
    } finally {
      setDeletingId(null);
    }
  }

  /** 标量值 → 展示文本：status / priority 走 i18n 标签，空值回 notSet。 */
  function scalarText(type: ProjectActivityType, value: string | null): string {
    if (value === null || value === "") return t("notSet");
    if (type === "status" && value in STATUS_LABEL_KEY) {
      return t(STATUS_LABEL_KEY[value as ProjectStatus]);
    }
    if (type === "priority" && value in PRIORITY_LABEL_KEY) {
      return t(PRIORITY_LABEL_KEY[value as TaskPriority]);
    }
    return value;
  }

  /** 动态行正文（actor 前缀由行模板渲染，这里只出动作短语）。 */
  function activityText(item: Extract<TimelineItem, { kind: "activity" }>): string {
    const { type, payload } = item;
    if (type === "created") return t("activityCreated");

    if (!payload) return "";

    switch (payload.kind) {
      case "scalar": {
        if (type === "lead" && payload.to === null) {
          return t("activityLeadCleared");
        }
        const from = scalarText(type, payload.from);
        const to = scalarText(type, payload.to);
        switch (type) {
          case "name":
            return t("activityName", { from, to });
          case "summary":
            return t("activitySummary", { from, to });
          case "description":
            return t("activityDescription", { from, to });
          case "status":
            return t("activityStatus", { from, to });
          case "priority":
            return t("activityPriority", { from, to });
          case "start_date":
            return t("activityStartDate", { from, to });
          case "end_date":
            return t("activityEndDate", { from, to });
          case "lead":
            return t("activityLead", { from, to });
          default:
            return "";
        }
      }
      case "refs": {
        const from = payload.from.map((ref) => ref.name).join(", ") || t("notSet");
        const to = payload.to.map((ref) => ref.name).join(", ") || t("notSet");
        return type === "members"
          ? t("activityMembers", { from, to })
          : t("activityTags", { from, to });
      }
      case "milestone_added":
        return t("activityMilestoneAdded", { name: payload.name });
      case "milestone_removed":
        return t("activityMilestoneRemoved", { name: payload.name });
      case "milestone_updated":
        return t("activityMilestoneField", {
          name: payload.name,
          field: t(MILESTONE_FIELD_LABEL_KEY[payload.field]),
          from: payload.from ?? t("notSet"),
          to: payload.to ?? t("notSet"),
        });
      default:
        return "";
    }
  }

  return (
    <div>
      {/* 评论输入区（Linear 同构：输入在上，时间线在下）。 */}
      <div>
        <Textarea
          value={draft}
          rows={6}
          maxLength={COMMENT_MAX_LENGTH}
          aria-label={t("commentAria")}
          placeholder={t("commentPlaceholder")}
          disabled={submitting}
          onChange={(event) => setDraft(event.target.value)}
        />
        <CharCounter value={draft} max={COMMENT_MAX_LENGTH} />

        <div className="mt-2.5 flex justify-end gap-2">
          <Button
            variant="outline"
            disabled={submitting || draft.length === 0}
            onClick={() => setDraft("")}
          >
            {tCommon("cancel")}
          </Button>
          <Button
            disabled={submitting || !draft.trim()}
            onClick={() => {
              void handleSubmit();
            }}
          >
            {submitting ? (
              <Loader2Icon className="animate-spin" aria-hidden="true" />
            ) : null}
            {t("postComment")}
          </Button>
        </div>
      </div>

      <ul className="mt-6 flex flex-col gap-4">
        {items.map((item, index) => {
          const delay = Math.min(index * ROW_STAGGER, ROW_STAGGER_CAP);
          if (item.kind === "activity") {
            const Icon = TYPE_ICON[item.type];
            return (
              <motion.li
                key={`activity-${item.id}`}
                initial={{ opacity: 0, y: 2 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ ...ROW_TRANSITION, delay }}
                className="flex items-start gap-2.5 text-[13.5px] leading-relaxed text-[var(--ink-700)]"
              >
                <Icon
                  className="mt-0.5 size-4 shrink-0 text-[var(--ink-400)]"
                  aria-hidden="true"
                />
                <p className="min-w-0 break-words">
                  <span className="font-semibold text-[var(--ink-900)]">
                    {item.actor.name}
                  </span>{" "}
                  {activityText(item)}{" "}
                  <span className="text-[12px] text-[var(--ink-400)]">
                    · {formatTaskTimestamp(item.createdAt)}
                  </span>
                </p>
              </motion.li>
            );
          }

          return (
            <motion.li
              key={`comment-${item.id}`}
              initial={{ opacity: 0, y: 2 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ ...ROW_TRANSITION, delay }}
              className="group flex gap-3"
            >
              <UserAvatar
                userId={item.author.id}
                name={item.author.name}
                size={30}
              />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-[13.5px] font-semibold text-[var(--ink-900)]">
                    {item.author.name}
                  </span>
                  <span className="text-[12px] text-[var(--ink-400)]">
                    {formatTaskTimestamp(item.createdAt)}
                  </span>

                  {item.author.id === currentUserId ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="ml-auto text-destructive opacity-0 hover:text-destructive focus-visible:opacity-100 group-hover:opacity-100"
                      disabled={deletingId === item.id}
                      onClick={() => {
                        void handleDelete(item.id);
                      }}
                    >
                      {deletingId === item.id ? (
                        <Loader2Icon className="animate-spin" aria-hidden="true" />
                      ) : null}
                      {tCommon("delete")}
                    </Button>
                  ) : null}
                </div>
                <p className="mt-1 whitespace-pre-wrap break-words text-[13.5px] leading-relaxed text-[var(--ink-700)]">
                  {item.content}
                </p>

                <div className="mt-1.5">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 gap-1.5 rounded-[var(--radius-pill)] px-2.5 text-[12.5px] text-[var(--ink-500)] hover:text-[var(--ink-900)]"
                    data-testid="thread-replies-toggle"
                    aria-expanded={expandedThreads.has(item.id)}
                    onClick={() => toggleThread(item.id)}
                  >
                    <MessageCircleIcon className="size-3.5" aria-hidden="true" />
                    {item.replies.length > 0
                      ? t("replyCount", { count: item.replies.length })
                      : t("commentReply")}
                  </Button>
                </div>

                {expandedThreads.has(item.id) ? (
                  <motion.div
                    initial={{ opacity: 0, y: 2 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={ROW_TRANSITION}
                    className="mt-2"
                  >
                    {item.replies.length > 0 ? (
                      <div className="flex flex-col gap-3 border-l-2 border-[var(--border)] pl-3">
                        {item.replies.map((reply) => (
                          <div key={reply.id} className="group/reply flex gap-2.5">
                            <UserAvatar
                              userId={reply.author.id}
                              name={reply.author.name}
                              size={24}
                            />
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-2">
                                <span className="text-[13px] font-semibold text-[var(--ink-900)]">
                                  {reply.author.name}
                                </span>
                                <span className="text-[12px] text-[var(--ink-400)]">
                                  {formatTaskTimestamp(reply.createdAt)}
                                </span>

                                {reply.author.id === currentUserId ? (
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    className="ml-auto text-destructive opacity-0 hover:text-destructive focus-visible:opacity-100 group-hover/reply:opacity-100"
                                    disabled={deletingId === reply.id}
                                    onClick={() => {
                                      void handleDelete(reply.id);
                                    }}
                                  >
                                    {deletingId === reply.id ? (
                                      <Loader2Icon
                                        className="animate-spin"
                                        aria-hidden="true"
                                      />
                                    ) : null}
                                    {tCommon("delete")}
                                  </Button>
                                ) : null}
                              </div>
                              <p className="mt-0.5 whitespace-pre-wrap break-words text-[13px] leading-relaxed text-[var(--ink-700)]">
                                {reply.content}
                              </p>
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : null}

                    {/* 回复输入固定在线程最底部（Linear 同构）。 */}
                    <div className="mt-3">
                      <Textarea
                        value={replyDrafts[item.id] ?? ""}
                        rows={6}
                        maxLength={COMMENT_MAX_LENGTH}
                        aria-label={t("replyAria")}
                        placeholder={t("replyPlaceholder")}
                        disabled={replySubmittingRoot === item.id}
                        onChange={(event) =>
                          setThreadDraft(item.id, event.target.value)
                        }
                      />
                      <CharCounter
                        value={replyDrafts[item.id] ?? ""}
                        max={COMMENT_MAX_LENGTH}
                      />
                      <div className="mt-2.5 flex justify-end gap-2">
                        <Button
                          variant="outline"
                          disabled={
                            replySubmittingRoot === item.id ||
                            (replyDrafts[item.id] ?? "").length === 0
                          }
                          onClick={() => clearThreadDraft(item.id)}
                        >
                          {tCommon("cancel")}
                        </Button>
                        <Button
                          disabled={
                            replySubmittingRoot === item.id ||
                            !(replyDrafts[item.id] ?? "").trim()
                          }
                          onClick={() => {
                            void handleReplySubmit(item.id);
                          }}
                        >
                          {replySubmittingRoot === item.id ? (
                            <Loader2Icon className="animate-spin" aria-hidden="true" />
                          ) : null}
                          {t("postComment")}
                        </Button>
                      </div>
                    </div>
                  </motion.div>
                ) : null}
              </div>
            </motion.li>
          );
        })}
      </ul>
    </div>
  );
}
