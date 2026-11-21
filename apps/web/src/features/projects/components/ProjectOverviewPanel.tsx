"use client";

import type { Project, ProjectMemberRef, Tag, TaskPriority } from "@open-doing/types";
import {
  CalendarPlusIcon,
  CheckIcon,
  ChevronRightIcon,
  MoreHorizontalIcon,
  PencilIcon,
  PlusIcon,
  XIcon,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { toast } from "sonner";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/shadcn/dropdown-menu";
import { ConfirmModal } from "@/components/ui/ConfirmModal";
import { Button } from "@/components/ui/shadcn/button";
import { Input } from "@/components/ui/shadcn/input";
import { Textarea } from "@/components/ui/shadcn/textarea";
import { Calendar } from "@/components/ui/shadcn/calendar";
import { UserAvatar } from "@/components/ui/UserAvatar";
import { addPersonalProjectMilestoneAction } from "@/features/personal/projects/actions";
import { addTeamProjectMilestoneAction } from "../actions";
import {
  deletePersonalProjectMilestoneAction,
  updatePersonalProjectMilestoneAction,
  updatePersonalProjectAction,
} from "@/features/personal/projects/actions";
import {
  deleteTeamProjectMilestoneAction,
  updateTeamProjectMilestoneAction,
  updateTeamProjectAction,
} from "../actions";
import type { MilestoneProgress } from "../service";
import { PROJECT_STATUS_COLORS } from "../constants";

import { MilestoneDatePopover } from "./MilestoneDatePopover";
import { ProjectStatusPill } from "./ProjectStatusPill";
import { TagPill } from "@/features/tags/components/TagPill";
import { AttrPill } from "./AttrPill";
import { type ProjectFormSpace } from "./ProjectForm";

export interface ProjectOverviewPanelProps {
  project: Project;
  /** 概览里程碑行（进度口径见 service） */
  milestones: import("../service").MilestoneProgress[];
  memberPool: ProjectMemberRef[];
  /** 项目类型标签池（标签行编辑用）。 */
  projectTagPool?: import("@open-doing/types").Tag[];
  displayLead: ProjectMemberRef | null;
  displayMembers: ProjectMemberRef[];
  canManage: boolean;
  space: ProjectFormSpace;
}

type EditableField = "summary" | "description" | null;

/** `YYYY-MM-DD` -> Date（Calendar 受控值）。 */
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
 * 概览主列（Linear 布局）：大标题 → 简述 → 属性行（可内联编辑 pills）→
 * 标签行 → 描述（内联编辑）→ 里程碑进度行（只读，CRUD 在侧栏）。
 */
export function ProjectOverviewPanel({
  project,
  milestones,
  memberPool,
  projectTagPool = [],
  displayLead,
  displayMembers,
  canManage,
  space,
}: ProjectOverviewPanelProps) {
  const t = useTranslations("projects");
  const tCommon = useTranslations("common");
  const tTags = useTranslations("tags");
  const tErrors = useTranslations("errors");
  const router = useRouter();
  const [milestoneCreating, setMilestoneCreating] = useState(false);
  const [newMilestoneName, setNewMilestoneName] = useState("");
  const [newMilestoneDescription, setNewMilestoneDescription] = useState("");
  const [newMilestoneDue, setNewMilestoneDue] = useState("");
  /** 主列行内重命名的里程碑 id（编辑态）。 */
  const [milestoneEditingId, setMilestoneEditingId] = useState<string | null>(null);
  const [milestoneEditName, setMilestoneEditName] = useState("");
  /** 待删除里程碑（ConfirmModal）。 */
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  /** 展开描述的里程碑 id 集合 */
  const [expandedMilestones, setExpandedMilestones] = useState<Set<string>>(new Set());
  const draftNameRef = useRef<HTMLInputElement | null>(null);

  const toggleMilestoneExpanded = (id: string) => {
    setExpandedMilestones((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  const [editingField, setEditingField] = useState<EditableField>(null);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [endDate, setEndDate] = useState(project.endDate ?? "");
  const [tagIds, setTagIds] = useState<string[]>(project.tags?.map((tag) => tag.id) ?? []);
  const [syncedProject, setSyncedProject] = useState(project);
  if (project !== syncedProject) {
    setSyncedProject(project);
    setEndDate(project.endDate ?? "");
  }
  const priorityLabel = (value: TaskPriority) =>
    t(
      value === "high"
        ? "priorityHigh"
        : value === "medium"
          ? "priorityMedium"
          : "priorityLow",
    );

  const projectId = project.id;

  const saveField = async (payload: Record<string, unknown>) => {
    if (saving) return;
    setSaving(true);
    try {
      const result =
        space.kind === "team"
          ? await updateTeamProjectAction({ teamId: space.teamId, projectId, ...payload })
          : await updatePersonalProjectAction(projectId, payload);
      if (!result.ok) {
        toast.error(result.errors.form ?? tErrors("operationFailed"));
        return false;
      }
      router.refresh();
      return true;
    } catch {
      toast.error(tCommon("networkError"));
      return false;
    } finally {
      setSaving(false);
    }
  };

  /** 草稿行确认：调里程碑创建 action。 */
  const confirmMilestone = async () => {
    if (saving || newMilestoneName.trim().length === 0) return;
    setSaving(true);
    try {
      const result =
        space.kind === "team"
          ? await addTeamProjectMilestoneAction({
              teamId: space.teamId,
              projectId,
              name: newMilestoneName.trim(),
              description: newMilestoneDescription.trim() || undefined,
              dueDate: newMilestoneDue || null,
            })
          : await addPersonalProjectMilestoneAction(projectId, {
              name: newMilestoneName.trim(),
              description: newMilestoneDescription.trim() || undefined,
              dueDate: newMilestoneDue || null,
            });
      if (!result) {
        toast.error(tErrors("operationFailed"));
        return;
      }
      setMilestoneCreating(false);
      setNewMilestoneName("");
      setNewMilestoneDescription("");
      setNewMilestoneDue("");
      router.refresh();
    } catch {
      toast.error(tErrors("operationFailed"));
    } finally {
      setSaving(false);
    }
  };

  const cancelMilestone = () => {
    setMilestoneCreating(false);
    setNewMilestoneName("");
    setNewMilestoneDescription("");
    setNewMilestoneDue("");
  };

  /** 主列行内重命名保存。 */
  const saveMilestoneRename = async (milestoneId: string) => {
    if (milestoneEditName.trim().length === 0) return;
    try {
      const result =
        space.kind === "team"
          ? await updateTeamProjectMilestoneAction({
              teamId: space.teamId,
              projectId,
              milestoneId,
              name: milestoneEditName.trim(),
            })
          : await updatePersonalProjectMilestoneAction(projectId, milestoneId, {
              name: milestoneEditName.trim(),
            });
      if (!result.ok) {
        toast.error(result.errors.form ?? tErrors("operationFailed"));
        return;
      }
      setMilestoneEditingId(null);
      router.refresh();
    } catch {
      toast.error(tErrors("operationFailed"));
    }
  };

  /** 主列行删除。 */
  const removeMilestoneById = async (milestoneId: string) => {
    try {
      const result =
        space.kind === "team"
          ? await deleteTeamProjectMilestoneAction({ teamId: space.teamId, projectId, milestoneId })
          : await deletePersonalProjectMilestoneAction(projectId, milestoneId);
      if (!result.ok) {
        toast.error(result.errors.form ?? tErrors("operationFailed"));
        return;
      }
      setPendingDelete(null);
      router.refresh();
    } catch {
      toast.error(tErrors("operationFailed"));
    }
  };

  const startEdit = (field: Exclude<EditableField, null>, current: string) => {
    if (!canManage) return;
    setDraft(current);
    setEditingField(field);
  };

  const cancelEdit = () => {
    setEditingField(null);
    setDraft("");
  };

  const summaryValue = project.summary ?? project.description ?? "";

  return (
    <div className="mx-auto flex w-full max-w-[760px] flex-col gap-5">
      {/* 大标题 */}
      <h1 className="break-words text-[30px] font-bold leading-[1.15] tracking-[-0.01em] text-[var(--ink-900)]">
        {project.name}
      </h1>

      {/* 简述（内联编辑） */}
      <div>
        {editingField === "summary" ? (
          <div className="flex items-center gap-2">
            <Input
              value={draft}
              maxLength={100}
              onChange={(event) => setDraft(event.target.value)}
              disabled={saving}
              data-testid="project-summary-edit"
            />
            <Button
              type="button"
              size="icon"
              aria-label={tCommon("save")}
              disabled={saving}
              onClick={async () => {
                if (await saveField({ summary: draft })) cancelEdit();
              }}
            >
              <CheckIcon className="size-4" aria-hidden="true" />
            </Button>
            <Button
              type="button"
              size="icon"
              variant="ghost"
              aria-label={tCommon("cancel")}
              onClick={cancelEdit}
            >
              <XIcon className="size-4" aria-hidden="true" />
            </Button>
          </div>
        ) : (
          <button
            type="button"
            data-testid="project-summary-display"
            onClick={() => startEdit("summary", project.summary ?? "")}
            className={`block text-left text-[14px] text-[var(--color-text-secondary)] ${canManage ? "cursor-pointer hover:text-[var(--color-text)]" : "cursor-default"}`}
          >
            {summaryValue || t("summaryPlaceholder")}
            {canManage ? (
              <PencilIcon className="ml-1.5 inline size-3 text-[var(--color-text-muted)]" aria-hidden="true" />
            ) : null}
          </button>
        )}
      </div>

      {/* 属性行（可内联编辑；quiet 样式对照 Linear 主列）。 */}
      <div className="flex flex-wrap items-center gap-2 text-[13px]">
        <span className="text-[13px] text-[var(--color-text-muted)]">{t("propertiesTitle")}</span>
        <ProjectStatusPill
          status={project.status}
          disabled={!canManage}
          onChange={async (status) => {
            await saveField({ status });
          }}
          onError={(message) => toast.error(message)}
          testid="overview-status-pill"
          quiet
        />
        <AttrPill
          testid="overview-priority-pill"
          icon={null}
          quiet
          label={priorityLabel(project.priority)}
          valueActive
          disabled={!canManage || saving}
        >
          {(close) => (
            <div className="flex flex-col">
              {(["high", "medium", "low"] as const).map((value) => (
                <button
                  key={value}
                  type="button"
                  data-testid={`overview-priority-option-${value}`}
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
        </AttrPill>
        <AttrPill
          testid="overview-target-pill"
          icon={<CalendarPlusIcon className="size-3.5" aria-hidden="true" />}
          label={endDate ? endDate : t("notSet")}
          disabled={!canManage || saving}
          quiet
        >
          {(close) => (
            <Calendar
              mode="single"
              selected={parseISODate(endDate)}
              onSelect={(day) => {
                const next = day ? toISODate(day) : "";
                setEndDate(next);
                void saveField({ endDate: next || null });
                close();
              }}
              disabled={!canManage || saving}
            />
          )}
        </AttrPill>
        {space.kind === "team" && displayLead ? (
          <span className="inline-flex items-center gap-1.5 text-[var(--color-text-secondary)]">
            <UserAvatar userId={displayLead.id} name={displayLead.name} size={22} />
            {displayLead.name}
          </span>
        ) : null}
        {space.kind === "team" && displayMembers.length > 0 ? (
          <span className="inline-flex items-center gap-1 text-[var(--color-text-secondary)]">
            {displayMembers.map((member) => (
              <UserAvatar key={member.id} userId={member.id} name={member.name} size={22} />
            ))}
          </span>
        ) : null}
      </div>

      {/* 标签行（内联编辑：+ 钮弹出勾选列表）。 */}
      {projectTagPool && projectTagPool.length > 0 ? (
        <div className="flex flex-wrap items-center gap-2 text-[13px]">
          <span className="text-[13px] text-[var(--color-text-muted)]">{tTags("tagNameLabel")}</span>
          {tagIds.map((id) => {
            const tag = projectTagPool.find((item) => item.id === id);
            return tag ? <TagPill key={tag.id} name={tag.name} color={tag.color} /> : null;
          })}
          <AttrPill
            testid="overview-labels-add"
            icon={<PlusIcon className="size-3.5" aria-hidden="true" />}
            label=""
            disabled={!canManage || saving}
            quiet
          >
            {(close) => (
              <div className="flex max-h-56 w-[220px] flex-col overflow-y-auto">
                {projectTagPool.map((tag) => {
                  const checked = tagIds.includes(tag.id);
                  return (
                    <button
                      key={tag.id}
                      type="button"
                      data-testid={`overview-labels-option-${tag.id}`}
                      className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] transition-colors hover:bg-[var(--color-surface-hover)]"
                      onClick={() => {
                        const next = checked
                          ? tagIds.filter((id) => id !== tag.id)
                          : [...tagIds, tag.id];
                        setTagIds(next);
                        void saveField({ tagIds: next });
                      }}
                    >
                      <CheckIcon
                        className={`size-3.5 ${checked ? "text-[var(--color-primary)]" : "text-transparent"}`}
                        aria-hidden="true"
                      />
                      <TagPill name={tag.name} color={tag.color} />
                    </button>
                  );
                })}
              </div>
            )}
          </AttrPill>
        </div>
      ) : null}

      {/* 描述（内联编辑） */}
      <div className="flex flex-col gap-2">
        <p className="text-[13px] font-medium text-[var(--color-text)]">{t("descriptionLabel")}</p>
        {editingField === "description" ? (
          <div className="flex flex-col gap-2">
            <Textarea
              rows={4}
              value={draft}
              maxLength={500}
              onChange={(event) => setDraft(event.target.value)}
              disabled={saving}
              data-testid="project-description-edit"
            />
            <div className="flex justify-end gap-2">
              <Button
                type="button"
                size="sm"
                variant="ghost"
                disabled={saving}
                onClick={cancelEdit}
              >
                {tCommon("cancel")}
              </Button>
              <Button
                type="button"
                size="sm"
                disabled={saving}
                onClick={async () => {
                  if (await saveField({ description: draft })) cancelEdit();
                }}
              >
                {tCommon("save")}
              </Button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            data-testid="project-description-display"
            onClick={() => startEdit("description", project.description ?? "")}
            className={`block whitespace-pre-wrap rounded-[var(--radius-lg)] px-3 py-3 text-left text-[13.5px] leading-relaxed text-[var(--color-text-secondary)] ${canManage ? "cursor-pointer hover:bg-[var(--color-surface-hover)]" : "cursor-default"} bg-[var(--color-surface-inset)]`}
          >
            {project.description || t("descriptionHint")}
          </button>
        )}
      </div>

      {/* 里程碑区恒显（对照 Linear）：空态提示，添加入口在右侧 Milestones 卡。 */}
      <div className="flex flex-col gap-2">
        <p className="text-[13px] font-medium text-[var(--color-text)]">{t("milestoneLabel")}</p>
        {milestones.length === 0 && !milestoneCreating ? (
          <p className="py-2 text-[13px] text-[var(--color-text-muted)]">{t("milestoneEmpty")}</p>
        ) : (
          <ul className="flex flex-col">
            {milestones.map((item) => {
              const expanded = expandedMilestones.has(item.milestone.id);
              return (
            <li
              key={item.milestone.id}
              data-testid="overview-milestone-row"
              className="flex flex-col border-b border-[var(--border)] py-2.5 last:border-b-0"
            >
              <div className="flex items-center gap-2.5">
                {item.milestone.description ? (
                  <button
                    type="button"
                    aria-expanded={expanded}
                    aria-label={t("milestoneLabel")}
                    data-testid={`overview-milestone-toggle-${item.milestone.id}`}
                    onClick={() => toggleMilestoneExpanded(item.milestone.id)}
                    className="cursor-pointer"
                  >
                    <ChevronRightIcon
                      className={`size-3.5 text-[var(--color-text-muted)] transition-transform duration-150 ${expanded ? "rotate-90" : ""}`}
                      aria-hidden="true"
                    />
                  </button>
                ) : null}
                <span
                  className="inline-block size-2.5 rotate-45 rounded-[2px] border border-[var(--color-text-muted)]"
                  aria-hidden="true"
                />
                {milestoneEditingId === item.milestone.id ? (
                  <Input
                    autoFocus
                    value={milestoneEditName}
                    maxLength={50}
                    data-testid={`overview-milestone-rename-${item.milestone.id}`}
                    onChange={(event) => setMilestoneEditName(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        void (space.kind === "team"
                          ? updateTeamProjectMilestoneAction({
                              teamId: space.teamId,
                              projectId,
                              milestoneId: item.milestone.id,
                              name: milestoneEditName.trim(),
                            })
                          : updatePersonalProjectMilestoneAction(projectId, item.milestone.id, {
                              name: milestoneEditName.trim(),
                            }));
                        setMilestoneEditingId(null);
                        router.refresh();
                      }
                      if (event.key === "Escape") setMilestoneEditingId(null);
                    }}
                    disabled={saving}
                    className="h-6 min-w-0 flex-1 border-none bg-transparent px-0 text-[13px] font-medium shadow-none focus-visible:ring-0"
                  />
                ) : (
                <span className="text-[13px] font-medium">{item.milestone.name}</span>
                )}
                {item.milestone.dueDate ? (
                  <span className="text-[12px] tabular-nums text-[var(--color-text-muted)]">
                    {item.milestone.dueDate}
                  </span>
                ) : null}
                <span className="ml-auto tabular-nums text-[12.5px] text-[var(--color-text-muted)]">
                  {t("milestoneProgressMeta", { count: item.taskCount, percent: item.percent })}
                </span>
                {canManage ? (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <button
                        type="button"
                        aria-label={tCommon("edit")}
                        data-testid={`overview-milestone-menu-${item.milestone.id}`}
                        className="inline-flex size-6 items-center justify-center rounded-md text-[var(--color-text-muted)] transition-colors hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text)]"
                      >
                        <MoreHorizontalIcon className="size-4" aria-hidden="true" />
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem
                        data-testid={`overview-milestone-edit-${item.milestone.id}`}
                        onSelect={() => {
                          setMilestoneEditingId(item.milestone.id);
                          setMilestoneEditName(item.milestone.name);
                        }}
                      >
                        {tCommon("edit")}
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        data-testid={`overview-milestone-delete-${item.milestone.id}`}
                        className="text-[var(--color-error)]"
                        onSelect={() => setPendingDelete(item.milestone.id)}
                      >
                        {tCommon("delete")}
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                ) : null}
              </div>
              {expanded && item.milestone.description ? (
                <p className="mt-1 pl-6 text-[12.5px] leading-relaxed text-[var(--color-text-secondary)]">
                  {item.milestone.description}
                </p>
              ) : null}
            </li>
              );
            })}
          </ul>
        )}

        {/* Linear 式草稿行：+ 里程碑 → 占位行（名称必填，Enter/✓ 提交，日期可选） */}
        {milestoneCreating && canManage ? (
          <div
            data-testid="overview-milestone-creating"
            className="mt-1 flex flex-col gap-1 rounded-[var(--radius-md)] bg-[var(--color-surface-inset)] px-3 py-2"
          >
            <div className="flex items-center gap-2">
            <span
              className="inline-block size-2.5 shrink-0 rotate-45 rounded-[2px] border border-[var(--color-text-muted)]"
              aria-hidden="true"
            />
            <Input
              autoFocus
              ref={draftNameRef}
              value={newMilestoneName}
              maxLength={50}
              placeholder={t("milestoneNameLabel")}
              data-testid="overview-milestone-name-input"
              onChange={(event) => setNewMilestoneName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") void confirmMilestone();
                if (event.key === "Escape") cancelMilestone();
              }}
              disabled={saving}
              className="h-auto min-w-0 flex-1 border-none bg-transparent px-0 text-[13px] font-medium shadow-none focus-visible:ring-0 dark:bg-transparent"
            />
            <MilestoneDatePopover
              value={newMilestoneDue}
              onChange={setNewMilestoneDue}
              disabled={saving}
              testid="overview-milestone-due"
              inputTestid="overview-milestone-due-input"
            >
              {newMilestoneDue || t("notSet")}
            </MilestoneDatePopover>
            <button
              type="button"
              aria-label={tCommon("cancel")}
              data-testid="overview-milestone-cancel"
              disabled={saving}
              onClick={cancelMilestone}
              className="text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
            >
              <XIcon className="size-4" aria-hidden="true" />
            </button>
            <button
              type="button"
              aria-label={tCommon("save")}
              data-testid="overview-milestone-confirm"
              disabled={saving || newMilestoneName.trim().length === 0}
              onClick={() => void confirmMilestone()}
              className="text-[var(--color-primary)] disabled:opacity-50"
            >
              <CheckIcon className="size-4" aria-hidden="true" />
            </button>
          </div>
          <Input
            type="text"
            value={newMilestoneDescription}
            maxLength={200}
            placeholder={t("milestoneDescriptionPlaceholder")}
            data-testid="overview-milestone-description-input"
            onChange={(event) => setNewMilestoneDescription(event.target.value)}
            disabled={saving}
            className="h-auto border-none bg-transparent px-0 pl-6 text-[13px] text-[var(--color-text-secondary)] shadow-none focus-visible:ring-0 dark:bg-transparent"
          />
          </div>
        ) : (
          canManage ? (
            <button
              type="button"
              data-testid="overview-milestone-create"
              className="mt-1 flex cursor-pointer items-center gap-1.5 text-[13px] text-[var(--color-text-muted)] transition-colors hover:text-[var(--color-text)]"
              onClick={() => setMilestoneCreating(true)}
            >
              <PlusIcon className="size-3.5" aria-hidden="true" />
              {t("milestoneAdd")}
            </button>
          ) : null
        )}
      </div>

      <ConfirmModal
        open={pendingDelete !== null}
        title={t("milestoneDelete")}
        content={t("milestoneSectionTitle")}
        confirmText={tCommon("delete")}
        danger
        onConfirm={async () => {
          if (!pendingDelete) return;
          const result =
            space.kind === "team"
              ? await deleteTeamProjectMilestoneAction({ teamId: space.teamId, projectId, milestoneId: pendingDelete })
              : await deletePersonalProjectMilestoneAction(projectId, pendingDelete);
          if (!result.ok) {
            toast.error(result.errors.form ?? tErrors("operationFailed"));
            return;
          }
          setPendingDelete(null);
          router.refresh();
        }}
        onCancel={() => setPendingDelete(null)}
        okButtonProps={{ "data-testid": "overview-milestone-delete-confirm" }}
      />
    </div>
  );
}
