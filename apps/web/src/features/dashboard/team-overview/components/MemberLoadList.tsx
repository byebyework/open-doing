"use client";

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

/** 计数文案：有值时用语义色，全 0 时显示「暂无进行中任务」。 */
function LoadSummary({ member }: { member: MemberLoad }) {
  const parts = [
    { label: "进行中", value: member.inProgress, color: "#5f6368" },
    { label: "临期", value: member.dueSoon, color: "#a66b00" },
    { label: "已逾期", value: member.overdue, color: "#ff5757" },
  ];

  return (
    <div className="mt-0.5 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 text-[12px] text-[#9aa0a6]">
      {parts.map((part) => (
        <span key={part.label} className="whitespace-nowrap">
          {part.label}{" "}
          <span
            className="font-semibold"
            style={{ color: part.value > 0 ? part.color : "#9aa0a6" }}
          >
            {part.value}
          </span>{" "}
          项
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
  const [expandedUserId, setExpandedUserId] = useState<string | null>(null);

  if (members.length === 0) {
    return (
      <EmptyState
        title="暂无成员"
        description="团队成员加入后，这里会展示各自的任务负载。"
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
              <UserAvatar username={member.username} />
              <div className="min-w-0 flex-1">
                <div className="truncate text-[13.5px] font-medium text-[#0e1318]">
                  {member.username}
                </div>
                <LoadSummary member={member} />
              </div>
              <span className="shrink-0 whitespace-nowrap text-[12px] text-[#5f6368]">
                {expanded ? "收起" : "查看任务"}
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
                className={`shrink-0 text-[#9aa0a6] transition-transform ${
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
                  <p className="py-1 text-[12.5px] text-[#9aa0a6]">
                    该成员暂无团队任务。
                  </p>
                ) : (
                  groups.map(([projectName, tasks]) => (
                    <div key={projectName} className="min-w-0 py-1">
                      <div className="truncate text-[12px] font-semibold text-[#5f6368]">
                        {projectName}
                      </div>
                      <ul className="mt-1 flex flex-col">
                        {tasks.map((task) => (
                          <li key={task.id} className="min-w-0">
                            <Link
                              href={task.href}
                              className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 rounded-md px-1 py-1.5 hover:bg-white"
                            >
                              <span className="w-full min-w-0 truncate text-[13px] text-[#0e1318] min-[861px]:w-auto min-[861px]:flex-1">
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
                                  <span className="whitespace-nowrap text-[12px] text-[#9aa0a6]">
                                    无截止日期
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
