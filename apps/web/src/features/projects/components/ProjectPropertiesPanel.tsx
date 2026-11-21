"use client";

import type { Project, ProjectMemberRef, ProjectStatus, TaskPriority } from "@open-doing/types";
import { CalendarPlusIcon, CheckIcon, ChevronRightIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { Calendar } from "@/components/ui/shadcn/calendar";
import { UserAvatar } from "@/components/ui/UserAvatar";
import { TagPill } from "@/features/tags/components/TagPill";
import { updatePersonalProjectAction } from "@/features/personal/projects/actions";
import { updateTeamProjectAction } from "../actions";
import { AttrPill } from "./AttrPill";
import { CollapseReveal } from "./CollapseReveal";
import { ProjectStatusPill } from "./ProjectStatusPill";
import { type ProjectFormSpace } from "./ProjectForm";

/** 成员行头像栈封顶数；超出并入「+N」圆点（悬停显示全名单）。 */
const MEMBER_AVATAR_LIMIT = 4;

export interface ProjectPropertiesPanelProps {
  project: Project;
  memberPool: ProjectMemberRef[];
  canManage: boolean;
  space: ProjectFormSpace;
}

/** `YYYY-MM-DD` -> Date / Date -> `YYYY-MM-DD`（同 ProjectForm 口径）。 */
function parseISODate(value: string): Date | undefined {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime()) ? undefined : date;
}
function toISODate(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/**
 * 右侧 Properties 编辑卡：label 左 / 可编辑值右的行式布局。
 * 与概览属性行复用同一批 pill 组件；单字段更新走既有 update action。
 */
export function ProjectPropertiesPanel({
  project,
  memberPool,
  canManage,
  space,
}: ProjectPropertiesPanelProps) {
  const t = useTranslations("projects");
  const tTags = useTranslations("tags");
  const tCommon = useTranslations("common");
  const tErrors = useTranslations("errors");
  const router = useRouter();
  const [collapsed, setCollapsed] = useState(false);
  const [tagIds, setTagIds] = useState<string[]>(project.tags?.map((tag) => tag.id) ?? []);
  // 项目负责人/成员本地态（Properties 行可编辑；渲染期同步 RSC 快照）
  const [syncedProject, setSyncedProject] = useState(project);
  const [leadId, setLeadId] = useState<string | null>(project.leadId);
  const [memberIds, setMemberIds] = useState<string[]>(
    project.members?.map((member) => member.id) ?? [],
  );
  if (project !== syncedProject) {
    setSyncedProject(project);
    setLeadId(project.leadId);
    setMemberIds(project.members?.map((member) => member.id) ?? []);
  }

  const saveField = async (payload: Record<string, unknown>): Promise<boolean> => {
    try {
      const result =
        space.kind === "team"
          ? await updateTeamProjectAction({ teamId: space.teamId, projectId: project.id, ...payload })
          : await updatePersonalProjectAction(project.id, payload);
      if (!result.ok) {
        toast.error(result.errors.form ?? tErrors("operationFailed"));
        return false;
      }
      router.refresh();
      return true;
    } catch {
      toast.error(tCommon("networkError"));
      return false;
    }
  };

  const priorityLabel = (value: TaskPriority) =>
    t(value === "high" ? "priorityHigh" : value === "medium" ? "priorityMedium" : "priorityLow");

  // 行值节点：负责人 = 头像 + 名称；成员 = 头像栈（与负责人行可区分）
  const leadRef = memberPool.find((member) => member.id === leadId) ?? null;
  const memberRefs = memberIds
    .map((id) => memberPool.find((member) => member.id === id))
    .filter((member): member is ProjectMemberRef => Boolean(member));
  const visibleMembers = memberRefs.slice(0, MEMBER_AVATAR_LIMIT);
  const memberOverflow = memberRefs.length - visibleMembers.length;

  const row = (label: string, value: React.ReactNode, testid?: string) => (
    <div className="flex items-center justify-between gap-2 py-1.5" data-testid={testid}>
      <span className="text-[12.5px] text-[var(--color-text-muted)]">{label}</span>
      <span className="flex min-w-0 items-center justify-end">{value}</span>
    </div>
  );

  return (
    <section
      data-testid="project-properties-panel"
      className="rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--card)] p-4"
    >
      <button
        type="button"
        data-testid="properties-collapse"
        aria-expanded={!collapsed}
        onClick={() => setCollapsed((current) => !current)}
        className="mb-2 flex cursor-pointer items-center gap-2 text-[13px] font-semibold text-[var(--ink-900)]"
      >
        {t("propertiesTitle")}
        <ChevronRightIcon
          className={`size-3.5 text-[var(--color-text-muted)] transition-transform duration-150 ${collapsed ? "" : "rotate-90"}`}
          aria-hidden="true"
        />
      </button>
      <CollapseReveal open={!collapsed}>
        <div className="flex flex-col divide-y divide-[var(--border)]">
        {row(
          t("colStatus"),
          <ProjectStatusPill
            status={project.status}
            disabled={!canManage}
            onChange={async (status: ProjectStatus) => {
              await saveField({ status });
            }}
            onError={(message) => toast.error(message)}
            testid="properties-status-pill"
            quiet
          />,
        )}
        {row(
          t("colPriority"),
          <AttrPill
            testid="properties-priority-pill"
            icon={null}
            label={priorityLabel(project.priority)}
            valueActive
            disabled={!canManage}
          >
            {(close) => (
              <div className="flex flex-col">
                {(["high", "medium", "low"] as const).map((value) => (
                  <button
                    key={value}
                    type="button"
                    data-testid={`properties-priority-option-${value}`}
                    className="flex cursor-pointer items-center rounded-md px-2 py-1.5 text-left text-[13px] transition-colors hover:bg-[var(--color-surface-hover)]"
                    onClick={() => {
                      void saveField({ priority: value });
                      close();
                    }}
                  >
                    {priorityLabel(value)}
                  </button>
                ))}
              </div>
            )}
          </AttrPill>,
        )}
        {space.kind === "team" && memberPool.length > 0
          ? row(
              t("leadLabel"),
              <AttrPill
                quiet
                testid="properties-lead-pill"
                icon={null}
                label={
                  leadRef ? (
                    <span className="inline-flex items-center gap-1.5">
                      <UserAvatar userId={leadRef.id} name={leadRef.name} size={20} />
                      {leadRef.name}
                    </span>
                  ) : (
                    t("notSet")
                  )
                }
                valueActive
                disabled={!canManage}
              >
                {(close) => (
                  <div className="flex max-h-56 flex-col overflow-y-auto">
                    {leadId ? (
                      <button
                        type="button"
                        data-testid="properties-lead-clear"
                        className="flex cursor-pointer items-center rounded-md px-2 py-1.5 text-left text-[13px] text-[var(--color-text-muted)] transition-colors hover:bg-[var(--color-surface-hover)]"
                        onClick={() => {
                          // 负责人取消：同步移出成员（双向一致）
                          const next = memberIds.filter((id) => id !== leadId);
                          setMemberIds(next);
                          setLeadId(null);
                          void saveField({ leadId: null, memberIds: next });
                          close();
                        }}
                      >
                        {t("notSet")}
                      </button>
                    ) : null}
                    {memberPool.map((member) => (
                      <button
                        key={member.id}
                        type="button"
                        data-testid={`properties-lead-option-${member.id}`}
                        className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] transition-colors hover:bg-[var(--color-surface-hover)]"
                        onClick={() => {
                          setLeadId(member.id);
                          void saveField({ leadId: member.id });
                          close();
                        }}
                      >
                        <UserAvatar userId={member.id} name={member.name} size={22} />
                        {member.name}
                      </button>
                    ))}
                  </div>
                )}
              </AttrPill>,
            )
          : null}
        {space.kind === "team" && memberPool.length > 0
          ? row(
              t("membersLabel"),
              <AttrPill
                quiet
                testid="properties-members-pill"
                icon={null}
                label={
                  memberRefs.length > 0 ? (
                    <span className="flex items-center -space-x-1">
                      {visibleMembers.map((member) => (
                        <UserAvatar
                          key={member.id}
                          userId={member.id}
                          name={member.name}
                          size={20}
                          className="ring-2 ring-[var(--card)]"
                        />
                      ))}
                      {memberOverflow > 0 ? (
                        <span
                          title={memberRefs.map((member) => member.name).join("、")}
                          className="inline-flex h-5 items-center rounded-full bg-[var(--color-surface-hover)] px-1.5 text-[11px] font-medium text-[var(--color-text-secondary)] ring-2 ring-[var(--card)]"
                        >
                          +{memberOverflow}
                        </span>
                      ) : null}
                    </span>
                  ) : (
                    t("notSet")
                  )
                }
                disabled={!canManage}
              >
                {(close) => (
                  <div className="flex max-h-56 flex-col overflow-y-auto">
                    {memberPool.map((member) => {
                      const checked = memberIds.includes(member.id);
                      return (
                        <button
                          key={member.id}
                          type="button"
                          data-testid={`properties-member-option-${member.id}`}
                          className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] transition-colors hover:bg-[var(--color-surface-hover)]"
                          onClick={() => {
                            const next = checked
                              ? memberIds.filter((id) => id !== member.id)
                              : [...memberIds, member.id];
                            setMemberIds(next);
                            // 双向一致：移除的成员若是负责人，leadId 一并清空；
                            // 否则透传 leadId，服务层不变式会把负责人自动并回成员。
                            // 移除成员时（checked 为 true）若他是负责人 → 清空 leadId
                            const clearLead = checked && member.id === leadId;
                            void saveField({
                              memberIds: next,
                              leadId: clearLead ? null : leadId,
                            });
                            if (clearLead) setLeadId(null);
                          }}
                        >
                          <UserAvatar userId={member.id} name={member.name} size={22} />
                          <span className="flex-1">{member.name}</span>
                          {checked ? (
                            <CheckIcon className="size-3.5 text-[var(--color-text)]" aria-hidden="true" />
                          ) : null}
                        </button>
                      );
                    })}
                  </div>
                )}
              </AttrPill>,
            )
          : null}
        {row(
          t("startDate"),
          <AttrPill
            quiet
            testid="properties-start-pill"
            icon={<CalendarPlusIcon className="size-3.5" aria-hidden="true" />}
            label={project.startDate ?? t("notSet")}
            disabled={!canManage}
          >
            {(close) => (
              <Calendar
                mode="single"
                selected={parseISODate(project.startDate ?? "")}
                onSelect={(day) => {
                  void saveField({ startDate: day ? toISODate(day) : null });
                  close();
                }}
                disabled={!canManage}
              />
            )}
          </AttrPill>,
        )}
        {row(
          t("endDate"),
          <AttrPill
            quiet
            testid="properties-end-pill"
            icon={<CalendarPlusIcon className="size-3.5" aria-hidden="true" />}
            label={project.endDate ?? t("notSet")}
            disabled={!canManage}
          >
            {(close) => (
              <Calendar
                mode="single"
                selected={parseISODate(project.endDate ?? "")}
                onSelect={(day) => {
                  void saveField({ endDate: day ? toISODate(day) : null });
                  close();
                }}
                disabled={!canManage}
              />
            )}
          </AttrPill>,
        )}
        {projectTagPoolRow()}
        </div>
      </CollapseReveal>
    </section>
  );

  function projectTagPoolRow() {
    if (!project.tags || project.tags.length === 0) return null;
    return row(
      tTags("tagNameLabel"),
      <span className="flex flex-wrap items-center justify-end gap-1">
        {project.tags.map((tag) => (
          <TagPill key={tag.id} name={tag.name} color={tag.color} />
        ))}
      </span>,
    );
  }
}
