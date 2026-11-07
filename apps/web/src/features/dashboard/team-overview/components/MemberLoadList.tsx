"use client";

import { displayName } from "@open-doing/types";
import { useTranslations } from "next-intl";
import { useState } from "react";
import Link from "next/link";

import { DueText } from "@/components/ui/DueText";
import { EmptyState } from "@/components/ui/EmptyState";
import { StatusTag } from "@/components/ui/StatusTag";
import { UserAvatar } from "@/components/ui/UserAvatar";

import type { MemberLoad } from "../service";

/** 成员负载列表入参。 */
export interface MemberLoadListProps {
  /** 团队成员及其负载（服务端已按加入时间排序）。 */
  members: MemberLoad[];
  /** 今天（Asia/Shanghai，`YYYY-MM-DD`），用于逾期 / 临期判定。 */
  today: string;
}

/** 把成员任务按项目分组（保持服务端返回的截止日期顺序）。 */
function groupTasksByProject(tasks: MemberLoad["tasks"]) {
  const groups = new Map<string, MemberLoad["tasks"]>();
  for (const task of tasks) {
    const list = groups.get(task.projectName) ?? [];
    list.push(task);
    groups.set(task.projectName, list);
  }
  return Array.from(groups.entries());
}

/** 计数文案：有值时用语义色，全 0 时置灰。文案按语言在渲染期翻译。 */
function LoadSummary({ member }: { member: MemberLoad }) {
  const t = useTranslations("dashboard");
  const parts = [
    {
      key: "loadInProgress",
      value: member.inProgress,
      color: "var(--ink-500)",
    },
    { key: "loadDueSoon", value: member.dueSoon, color: "#a66b00" },
    { key: "loadOverdue", value: member.overdue, color: "var(--status-overdue)" },
  ] as const;

  return (
    <div className="mt-0.5 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 text-[12px] text-[var(--ink-400)]">
      {parts.map((part) => (
        <span key={part.key} className="whitespace-nowrap">
          <span
            className="font-semibold"
            style={{ color: part.value > 0 ? part.color : "var(--ink-400)" }}
          >
            {t(part.key, { count: part.value })}
          </span>
        </span>
      ))}
    </div>
  );
}

/**
 * 成员负载（D-3）：只读列表 + 行内下钻。
 *
 * 行内下钻展示该成员在本团队各项目中的任务（含已完成，状态标签可辨）；
 * 负载计数只统计未完成口径，与服务端 `MemberLoad` 一致。
 * 组件不提供任何改派 / 催办入口——概览页保持只读。
 */
export function MemberLoadList({ members, today }: MemberLoadListProps) {
  const t = useTranslations("dashboard");
  const [expandedUserId, setExpandedUserId] = useState<string | null>(null);

  if (members.length === 0) {
    return (
      <EmptyState
        title={t("emptyMembersTitle")}
        description={t("emptyMembersDescription")}
      />
    );
  }

  return (
    <ul className="mt-2 flex flex-col">
      {members.map((member) => {
        const expanded = expandedUserId === member.userId;
        const groups = groupTasksByProject(member.tasks);
        const panelId = `member-load-${member.userId}`;

        return (
          <li
            key={member.userId}
            className="border-t border-[#eceef0] first:border-t-0"
          >
            <button
              type="button"
              aria-expanded={expanded}
              aria-controls={panelId}
              onClick={() => setExpandedUserId(expanded ? null : member.userId)}
              className="flex w-full min-w-0 items-center gap-3 py-3 text-left hover:bg-[#f4f5f7]"
            >
              <UserAvatar userId={member.userId} name={displayName(member)} />
              <div className="min-w-0 flex-1">
                <div className="truncate text-[13.5px] font-medium text-[var(--ink-900)]">
                  {displayName(member)}
                </div>
                {/* 成员卡片展示邮箱（规格 §1）；未填写时不占行高。 */}
                {member.email ? (
                  <div className="truncate text-[12px] text-[var(--ink-400)]">
                    {member.email}
                  </div>
                ) : null}
                <LoadSummary member={member} />
              </div>
              <span className="shrink-0 whitespace-nowrap text-[12px] text-[var(--ink-500)]">
                {expanded ? t("collapse") : t("viewTasks")}
              </span>
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
                className={`shrink-0 text-[var(--ink-400)] transition-transform ${
                  expanded ? "rotate-180" : ""
                }`}
              >
                <path d="m6 9 6 6 6-6" />
              </svg>
            </button>

            {expanded ? (
              <div
                id={panelId}
                className="mb-3 min-w-0 rounded-lg bg-[#f4f5f7] px-3 py-2"
              >
                {groups.length === 0 ? (
                  <p className="py-1 text-[12.5px] text-[var(--ink-400)]">
                    {t("memberNoTasks")}
                  </p>
                ) : (
                  groups.map(([projectName, tasks]) => (
                    <div key={projectName} className="min-w-0 py-1">
                      <div className="truncate text-[12px] font-semibold text-[var(--ink-500)]">
                        {projectName}
                      </div>
                      <ul className="mt-1 flex flex-col">
                        {tasks.map((task) => (
                          <li key={task.id} className="min-w-0">
                            <Link
                              href={task.href}
                              className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 rounded-md px-1 py-1.5 hover:bg-white"
                            >
                              <span className="w-full min-w-0 truncate text-[13px] text-[var(--ink-900)] min-[861px]:w-auto min-[861px]:flex-1">
                                {task.title}
                              </span>
                              <span className="shrink-0">
                                <StatusTag status={task.status} />
                              </span>
                              <span className="shrink-0">
                                {task.dueDate ? (
                                  <DueText
                                    dueDate={task.dueDate}
                                    status={task.status}
                                    today={today}
                                  />
                                ) : (
                                  <span className="whitespace-nowrap text-[12px] text-[var(--ink-400)]">
                                    {t("noDueDate")}
                                  </span>
                                )}
                              </span>
                            </Link>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))
                )}
              </div>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
