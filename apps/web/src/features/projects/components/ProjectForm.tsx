"use client";

import type { Project, ProjectMemberRef, ProjectStatus, Tag, TaskPriority } from "@open-doing/types";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { zodResolver } from "@hookform/resolvers/zod";
import { CharCounter } from "@/components/ui/CharCounter";
import { Calendar } from "@/components/ui/shadcn/calendar";
import { UserAvatar } from "@/components/ui/UserAvatar";
import { TaskTagPicker, TagOptionList } from "@/features/tags/components/TaskTagPicker";
import { AttrPill } from "./AttrPill";
import {
  CalendarPlusIcon,
  CheckIcon,
  ChevronRightIcon,
  FlagIcon,
  Loader2Icon,
  PlusIcon,
  TagIcon,
  UserIcon,
  UsersIcon,
  XIcon,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { z } from "zod";

import { Button } from "@/components/ui/shadcn/button";
import { Input } from "@/components/ui/shadcn/input";
import { Textarea } from "@/components/ui/shadcn/textarea";
import {
  createPersonalProjectAction,
  updatePersonalProjectAction,
} from "@/features/personal/projects/actions";
import { applyActionErrors } from "@/lib/action-form";
import {
  createTeamProjectAction,
  updateTeamProjectAction,
} from "../actions";
import {
  PROJECT_DESCRIPTION_MAX_LENGTH,
  PROJECT_NAME_MAX_LENGTH,
  PROJECT_SUMMARY_MAX_LENGTH,
} from "../constants";
import { MilestoneDatePopover } from "./MilestoneDatePopover";
import { ProjectMilestoneEditor, type MilestoneDraftInput } from "./ProjectMilestoneEditor";
import { ProjectStatusPill } from "./ProjectStatusPill";

/** 表单服务的空间：团队（带 teamId）或个人。 */
export type ProjectFormSpace = { kind: "team"; teamId: string } | { kind: "personal" };

/** 编辑态项目入参：详情页/弹窗持有的 Project 均可直传。 */
export interface ProjectFormProject {
  id: string;
  name: string;
  /** 一句话简述（≤100 字符）。 */
  summary?: string;
  description?: string;
  startDate?: string | null;
  endDate?: string | null;
  priority?: TaskPriority;
  /** Linear 五态存储状态 */
  status?: ProjectStatus;
  leadId?: string | null;
  memberIds?: string[];
  tags?: Tag[];
}

export interface ProjectFormProps {
  space: ProjectFormSpace;
  /** 项目类型标签池（RSC 注入；空池不渲染标签区）。 */
  projectTagPool: Tag[];
  /** 团队成员池（RSC 注入；负责人/成员 pill 数据源；个人空间不传）。 */
  memberPool?: ProjectMemberRef[];
  /** 编辑态传项目（无里程碑区块）；新建不传。 */
  project?: ProjectFormProject;
  onSuccess: (project: Project) => void;
  onCancel?: () => void;
  /** testid 前缀，团队页用 "team-project"、个人页用 "personal-project"。 */
  testIdPrefix?: string;
  /**
   * Radix exit-hold 幂等闸：弹窗关闭（含退出保持窗口）时为 false，
   * 期间再提交不重复触发 action。默认 true（页面直渲无弹窗壳）。
   */
  open?: boolean;
}

interface MilestoneDraft extends MilestoneDraftInput {
  key: string;
}

const PRIORITIES: { value: TaskPriority; testidSuffix: string }[] = [
  { value: "high", testidSuffix: "high" },
  { value: "medium", testidSuffix: "medium" },
  { value: "low", testidSuffix: "low" },
];

/** `YYYY-MM-DD` -> 本地零时 Date（Calendar 受控值）。 */
function parseISODate(value: string): Date | undefined {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

/** Date -> `YYYY-MM-DD`（Calendar onSelect 回写）。 */
function toISODate(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/**
 * 团队/个人共用项目表单（新建与编辑统一 Linear pill 行布局）。
 *
 * 标题 → 简述 → 属性行（状态/负责人/成员/起止/优先级/标签）→ 详细描述 →
 * 里程碑折叠行（仅新建；编辑态统一在详情页管理）。字段错误按 field 回填，
 * 里程碑错误（field "milestones"）落表单级错误位。
 */
export function ProjectForm({
  space,
  projectTagPool,
  memberPool = [],
  project,
  onSuccess,
  onCancel,
  testIdPrefix = "project",
  open = true,
}: ProjectFormProps) {
  const t = useTranslations("projects");
  const tTags = useTranslations("tags");
  const tCommon = useTranslations("common");
  const prefersReducedMotion = useReducedMotion();
  const [submitting, setSubmitting] = useState(false);
  const [priority, setPriority] = useState<TaskPriority>(project?.priority ?? "medium");
  const [status, setStatus] = useState<ProjectStatus>(project?.status ?? "backlog");
  const [leadId, setLeadId] = useState<string | null>(project?.leadId ?? null);
  const [memberIds, setMemberIds] = useState<string[]>(project?.memberIds ?? []);
  const [tagIds, setTagIds] = useState<string[]>(project?.tags?.map((tag) => tag.id) ?? []);
  const [milestones, setMilestones] = useState<MilestoneDraft[]>([]);
  const [milestoneAdding, setMilestoneAdding] = useState(false);
  // 里程碑列表折叠态（对照 Linear：行内 ▶/▼ 切换；添加时自动展开）。
  const [milestonesOpen, setMilestonesOpen] = useState(false);
  /** 行点击编辑的草稿 key（编辑组件 = 新建组件 + 预填数据）。 */
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  const isEdit = Boolean(project);
  // 负责人/成员只在团队空间且池非空时渲染/提交（服务层再做不变式校验）
  const showMembership = space.kind === "team" && memberPool.length > 0;

  // zod schema 在组件内构建：长度文案取自 next-intl。
  const schema = z.object({
    name: z
      .string()
      .trim()
      .min(1, t("nameRequired"))
      .max(50, t("nameTooLong", { max: 50 })),
    summary: z.string().max(100, t("summaryTooLong", { max: 100 })),
    description: z.string().max(500, t("descriptionTooLong", { max: 500 })),
    startDate: z.string(),
    endDate: z.string(),
  });
  type FormValues = z.infer<typeof schema>;

  const {
    register,
    handleSubmit,
    setError,
    formState: { errors },
    watch,
    control,
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      name: project?.name ?? "",
      summary: project?.summary ?? "",
      description: project?.description ?? "",
      startDate: project?.startDate ?? "",
      endDate: project?.endDate ?? "",
    },
  });

  const nameValue = watch("name");
  const descriptionValue = watch("description");

  const addMilestone = (draft: MilestoneDraftInput) => {
    setMilestones((current) => [
      ...current,
      { ...draft, key: `${Date.now()}-${current.length}` },
    ]);
    setMilestonesOpen(true);
  };

  const removeMilestone = (key: string) => {
    setMilestones((current) => current.filter((item) => item.key !== key));
  };

  const updateMilestone = (key: string, draft: MilestoneDraftInput) => {
    setMilestones((current) =>
      current.map((item) =>
        item.key === key
          ? { ...item, name: draft.name, description: draft.description, dueDate: draft.dueDate }
          : item,
      ),
    );
  };

  const onSubmit = handleSubmit(async (values) => {
    // Radix exit-hold：关闭（含退出保持窗口）后不可再提交。
    if (!open || submitting) return;
    setSubmitting(true);
    setFormError(null);

    // 负责人/成员只在团队空间且池非空时随 payload 提交；lead 自动并入成员
    const membershipPayload = showMembership
      ? {
          status,
          leadId,
          memberIds: leadId ? Array.from(new Set([leadId, ...memberIds])) : memberIds,
        }
      : { status };

    const base = {
      name: values.name,
      summary: values.summary ?? "",
      description: values.description ?? "",
      startDate: values.startDate.trim() ? values.startDate : null,
      endDate: values.endDate.trim() ? values.endDate : null,
      priority,
      tagIds: projectTagPool.length > 0 ? tagIds : undefined,
      milestones:
        !isEdit && milestones.length > 0
          ? milestones.map(({ name, description, dueDate }) => ({ name, description, dueDate }))
          : undefined,
    };

    try {
      const result =
        space.kind === "team"
          ? isEdit
            ? await updateTeamProjectAction({
                teamId: space.teamId,
                projectId: project!.id,
                name: base.name,
                summary: base.summary,
                description: base.description,
                startDate: base.startDate,
                endDate: base.endDate,
                priority: base.priority,
                ...membershipPayload,
                tagIds: base.tagIds,
              })
            : await createTeamProjectAction({
                teamId: space.teamId,
                name: base.name,
                summary: base.summary,
                description: base.description,
                startDate: base.startDate,
                endDate: base.endDate,
                priority: base.priority,
                ...membershipPayload,
                tagIds: base.tagIds,
                milestones: base.milestones,
              })
          : isEdit
            ? await updatePersonalProjectAction(project!.id, {
                name: base.name,
                summary: base.summary,
                description: base.description,
                startDate: base.startDate,
                endDate: base.endDate,
                priority: base.priority,
                status,
                tagIds: base.tagIds,
              })
            : await createPersonalProjectAction({
                name: base.name,
                summary: base.summary,
                description: base.description,
                startDate: base.startDate,
                endDate: base.endDate,
                priority: base.priority,
                status,
                tagIds: base.tagIds,
                milestones: base.milestones,
              });

      if (!result.ok) {
        applyActionErrors(result.errors, {
          setFieldError: (name, message) => {
            if (name === "milestones") {
              setFormError(message);
              return;
            }
            setError(name as keyof FormValues, { message });
          },
          onFormError: setFormError,
        });
        return;
      }

      onSuccess(result.data);
    } catch {
      setFormError(tCommon("networkError"));
    } finally {
      setSubmitting(false);
    }
  });

  const priorityLabel = (value: TaskPriority) =>
    t(
      value === "high"
        ? "priorityHighLabel"
        : value === "medium"
          ? "priorityMediumLabel"
          : "priorityLowLabel",
    );

  /** 编辑中的草稿（行点击编辑 = 新建组件 + 预填数据）。 */
  const editingDraft = editingKey
    ? milestones.find((item) => item.key === editingKey)
    : undefined;

  const milestoneRows =
    !isEdit && !editingKey
      ? milestones.map((item, index) => (
          <div
            key={item.key}
            data-testid={`${testIdPrefix}-milestone-item`}
            className="flex items-center gap-2 rounded-[var(--radius-md)] border border-[var(--border)] px-3 py-2"
          >
            <FlagIcon className="size-3.5 text-[var(--color-primary)]" aria-hidden="true" />
            <button
              type="button"
              data-testid={`${testIdPrefix}-milestone-edit-${index}`}
              className="min-w-0 flex-1 cursor-pointer truncate text-left text-[13px] font-medium"
              disabled={submitting}
              onClick={() => setEditingKey(item.key)}
            >
              {item.name}
            </button>
            <MilestoneDatePopover
              value={item.dueDate}
              onChange={(dueDate) =>
                updateMilestone(item.key, {
                  name: item.name,
                  description: item.description,
                  dueDate,
                })
              }
              disabled={submitting}
              testid={`${testIdPrefix}-milestone-date-${index}`}
            />
            <button
              type="button"
              aria-label={t("milestoneRemove")}
              data-testid={`${testIdPrefix}-milestone-remove-${index}`}
              disabled={submitting}
              onClick={() => removeMilestone(item.key)}
              className="text-[var(--color-text-muted)] hover:text-[var(--color-error)]"
            >
              <XIcon className="size-3.5" aria-hidden="true" />
            </button>
          </div>
        ))
      : editingKey
        ? [
            <ProjectMilestoneEditor
              key="milestone-editing"
              initial={{
                name: editingDraft?.name,
                description: editingDraft?.description,
                dueDate: editingDraft?.dueDate,
              }}
              onSubmit={(draft) => {
                updateMilestone(editingKey, draft);
                setEditingKey(null);
              }}
              onCancel={() => setEditingKey(null)}
              submitting={submitting}
              testIdPrefix={testIdPrefix}
              submitLabel={tCommon("save")}
            />,
          ]
        : null;

  return (
    <form onSubmit={onSubmit} noValidate className="flex h-full flex-col">
      {formError ? (
        <div
          role="alert"
          data-testid={`${testIdPrefix}-form-error`}
          className="mb-3 rounded-[var(--radius-md)] border border-[var(--error)] bg-[var(--error-muted,var(--error))]/10 px-3 py-2 text-[12.5px] text-[var(--error)]"
        >
          {formError}
        </div>
      ) : null}

      {/* 大标题内联输入（占位即标签；必填在提交层校验）。 */}
      <Input
        type="text"
        data-testid={`${testIdPrefix}-name-input`}
        placeholder={t("nameLabel")}
        maxLength={50}
        autoFocus={!isEdit}
        aria-invalid={errors.name ? true : undefined}
        aria-describedby={errors.name ? `${testIdPrefix}-name-error` : undefined}
        disabled={submitting}
        className="h-auto border-none bg-transparent px-0 text-[22px] font-semibold shadow-none focus-visible:ring-0 dark:bg-transparent"
        {...register("name")}
      />
      {errors.name ? (
        <p id={`${testIdPrefix}-name-error`} className="mb-2 text-[12.5px] text-[var(--error)]">
          {errors.name.message}
        </p>
      ) : null}

      {/* 简述行（Linear「Add a short summary」；一句话简介，独立于详细描述）。 */}
      <Input
        type="text"
        data-testid={`${testIdPrefix}-summary-input`}
        placeholder={t("summaryLabel")}
        maxLength={100}
        aria-invalid={errors.summary ? true : undefined}
        disabled={submitting}
        className="h-auto border-none bg-transparent px-0 text-[14px] text-[var(--color-text-secondary)] shadow-none focus-visible:ring-0 dark:bg-transparent"
        {...register("summary")}
      />
      {errors.summary ? (
        <p className="mb-2 text-[12.5px] text-[var(--error)]">{errors.summary.message}</p>
      ) : null}

      {/* 属性行 pill：状态 / [负责人 / 成员（团队）] / 起止 / 优先级 / 标签。 */}
      <div className="my-3 flex flex-wrap items-center gap-2">
        <ProjectStatusPill
          status={status}
          onChange={setStatus}
          disabled={submitting}
          testid={`${testIdPrefix}-status-pill`}
        />

        {showMembership ? (
          <AttrPill
            testid={`${testIdPrefix}-lead-pill`}
            icon={<UserIcon className="size-3.5" aria-hidden="true" />}
            label={t("leadLabel")}
            value={memberPool.find((m) => m.id === leadId)?.name}
            valueActive
            disabled={submitting}
          >
            {(close) => (
              <div className="flex flex-col">
                {memberPool.map((member) => (
                  <button
                    key={member.id}
                    type="button"
                    data-testid={`${testIdPrefix}-lead-option-${member.id}`}
                    className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] transition-colors hover:bg-[var(--color-surface-hover)]"
                    onClick={() => {
                      setLeadId(member.id);
                      close();
                    }}
                  >
                    <UserAvatar userId={member.id} name={member.name} size={22} />
                    <span className="flex-1">{member.name}</span>
                    {leadId === member.id ? (
                      <CheckIcon className="size-3.5 text-[var(--color-text)]" aria-hidden="true" />
                    ) : null}
                  </button>
                ))}
              </div>
            )}
          </AttrPill>
        ) : null}

        {showMembership ? (
          <AttrPill
            testid={`${testIdPrefix}-members-pill`}
            icon={<UsersIcon className="size-3.5" aria-hidden="true" />}
            label={t("membersLabel")}
            value={memberIds.length > 0 ? String(memberIds.length) : undefined}
            disabled={submitting}
          >
            {(close) => (
              <div className="flex flex-col">
                {memberPool.map((member) => (
                  <button
                    key={member.id}
                    type="button"
                    data-testid={`${testIdPrefix}-member-option-${member.id}`}
                    className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] transition-colors hover:bg-[var(--color-surface-hover)]"
                    onClick={() => {
                      setMemberIds((current) =>
                        current.includes(member.id)
                          ? current.filter((id) => id !== member.id)
                          : [...current, member.id],
                      );
                    }}
                  >
                    <UserAvatar userId={member.id} name={member.name} size={22} />
                    <span className="flex-1">{member.name}</span>
                    {memberIds.includes(member.id) ? (
                      <CheckIcon className="size-3.5 text-[var(--color-text)]" aria-hidden="true" />
                    ) : null}
                  </button>
                ))}
              </div>
            )}
          </AttrPill>
        ) : null}

        <Controller
          control={control}
          name="startDate"
          render={({ field }) => (
            <AttrPill
              testid={`${testIdPrefix}-start-pill`}
              icon={<CalendarPlusIcon className="size-3.5" aria-hidden="true" />}
              label={t("startDate")}
              value={field.value ? field.value : t("notSet")}
              disabled={submitting}
            >
              {(close) => (
                <Calendar
                  mode="single"
                  selected={parseISODate(field.value ?? "")}
                  onSelect={(day) => {
                    field.onChange(day ? toISODate(day) : "");
                    close();
                  }}
                  disabled={submitting}
                />
              )}
            </AttrPill>
          )}
        />
        <Controller
          control={control}
          name="endDate"
          render={({ field }) => (
            <AttrPill
              testid={`${testIdPrefix}-end-pill`}
              icon={<CalendarPlusIcon className="size-3.5" aria-hidden="true" />}
              label={t("endDate")}
              value={field.value ? field.value : t("notSet")}
              disabled={submitting}
            >
              {(close) => (
                <Calendar
                  mode="single"
                  selected={parseISODate(field.value ?? "")}
                  onSelect={(day) => {
                    field.onChange(day ? toISODate(day) : "");
                    close();
                  }}
                  disabled={submitting}
                />
              )}
            </AttrPill>
          )}
        />
        <AttrPill
          testid={`${testIdPrefix}-priority-pill`}
          icon={<FlagIcon className="size-3.5" aria-hidden="true" />}
          label={t("priorityLabel")}
          value={priorityLabel(priority)}
          valueActive
          disabled={submitting}
        >
          {(close) => (
            <div className="flex flex-col">
              {PRIORITIES.map(({ value, testidSuffix }) => (
                <button
                  key={value}
                  type="button"
                  data-testid={`${testIdPrefix}-priority-option-${testidSuffix}`}
                  className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] transition-colors hover:bg-[var(--color-surface-hover)]"
                  onClick={() => {
                    setPriority(value);
                    close();
                  }}
                >
                  <FlagIcon className="size-3.5 text-[var(--color-text-muted)]" aria-hidden="true" />
                  {priorityLabel(value)}
                </button>
              ))}
            </div>
          )}
        </AttrPill>
        {/* 空池也渲染：TagOptionList 自带 tags.emptyPool 空态（入口常显）。 */}
        <AttrPill
          testid={`${testIdPrefix}-labels-pill`}
          icon={<TagIcon className="size-3.5" aria-hidden="true" />}
          label={tTags("tagNameLabel")}
          value={tagIds.length > 0 ? String(tagIds.length) : undefined}
          disabled={submitting}
        >
          {() => (
            <TagOptionList
              pool={projectTagPool}
              value={tagIds}
              onToggle={(tagId) => {
                setTagIds((current) =>
                  current.includes(tagId)
                    ? current.filter((id) => id !== tagId)
                    : [...current, tagId],
                );
              }}
            />
          )}
        </AttrPill>
      </div>

      <div className="my-3 border-t border-[var(--border)]" />

      {/* 详细描述大区域（对照 Linear「Write a description...」）：弹窗内弹性伸展。 */}
      <div className="flex min-h-0 flex-1 flex-col">
        <Textarea
          data-testid={`${testIdPrefix}-description-input`}
          placeholder={t("descriptionHint")}
          maxLength={500}
          aria-invalid={errors.description ? true : undefined}
          disabled={submitting}
          className="min-h-[160px] flex-1 resize-none border-none bg-transparent px-0 text-[14px] leading-relaxed shadow-none focus-visible:ring-0 dark:bg-transparent"
          {...register("description")}
        />
      </div>
      {errors.description ? (
        <p className="mb-2 text-[12.5px] text-[var(--error)]">{errors.description.message}</p>
      ) : null}

      <div className="my-3 border-t border-[var(--border)]" />

      {/* 里程碑折叠行：仅新建（编辑态统一在详情页管理）。 */}
      {!isEdit ? (
        <div className="rounded-[var(--radius-lg)] border border-[var(--border)] px-3 py-2.5">
          <div className="flex items-center gap-2">
            <button
              type="button"
              data-testid={`${testIdPrefix}-milestone-toggle`}
              aria-expanded={milestones.length > 0 ? milestonesOpen : undefined}
              disabled={milestones.length === 0}
              onClick={() => setMilestonesOpen((current) => !current)}
              className={`flex items-center gap-2 text-[14px] font-medium text-[var(--color-text)] ${
                milestones.length > 0 ? "cursor-pointer" : "cursor-default"
              }`}
            >
              {t("milestoneLabel")}
              {milestones.length > 0 ? (
                <>
                  <span className="rounded-full bg-[var(--color-primary-bg)] px-2 py-0.5 text-[12px] font-medium text-[var(--color-primary)]">
                    {milestones.length}
                  </span>
                  <ChevronRightIcon
                    className={`size-3.5 text-[var(--color-text-muted)] transition-transform duration-150 ${milestonesOpen ? "rotate-90" : ""}`}
                    aria-hidden="true"
                  />
                </>
              ) : null}
            </button>
            {!milestoneAdding ? (
              <Button
                type="button"
                variant="ghost"
                className="ml-auto"
                data-testid={`${testIdPrefix}-milestone-add-trigger`}
                disabled={submitting}
                onClick={() => {
                  setMilestoneAdding(true);
                  setMilestonesOpen(true);
                }}
              >
                <PlusIcon className="size-4" aria-hidden="true" />
                {t("milestoneAdd")}
              </Button>
            ) : null}
          </div>
          {/* 列表展开/收起与编辑器同一套拉出动效。 */}
          <AnimatePresence initial={false}>
            {milestonesOpen && milestones.length > 0 && !editingKey ? (
              <motion.div
                key="milestone-list"
                initial={prefersReducedMotion ? false : { height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1 }}
                exit={prefersReducedMotion ? { opacity: 0 } : { height: 0, opacity: 0 }}
                transition={
                  prefersReducedMotion
                    ? { duration: 0 }
                    : { height: { duration: 0.24, ease: [0.25, 0.1, 0.25, 1] }, opacity: { duration: 0.18 } }
                }
                className="overflow-hidden"
              >
                <div className="mt-2 flex flex-col gap-2">{milestoneRows}</div>
              </motion.div>
            ) : null}
          </AnimatePresence>
          {/* 展开动效：自上而下拉出（收起比展开快 1/3）；reduced-motion 时直接挂载。 */}
          <AnimatePresence initial={false}>
            {milestoneAdding || editingKey ? (
              <motion.div
                key="milestone-editor"
                initial={prefersReducedMotion ? false : { height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1 }}
                exit={prefersReducedMotion ? { opacity: 0 } : { height: 0, opacity: 0 }}
                transition={
                  prefersReducedMotion
                    ? { duration: 0 }
                    : { height: { duration: 0.24, ease: [0.25, 0.1, 0.25, 1] }, opacity: { duration: 0.18 } }
                }
                className="overflow-hidden"
              >
                {milestoneAdding ? (
                  <ProjectMilestoneEditor
                    onSubmit={(draft) => {
                      addMilestone(draft);
                      setMilestoneAdding(false);
                    }}
                    onCancel={() => {
                      setMilestoneAdding(false);
                      if (milestones.length === 0) setMilestonesOpen(false);
                    }}
                    submitting={submitting}
                    testIdPrefix={testIdPrefix}
                  />
                ) : (
                  (milestoneRows?.[0] as React.ReactElement | undefined)
                )}
              </motion.div>
            ) : null}
          </AnimatePresence>
        </div>
      ) : null}

      <div className="mt-4 flex justify-end gap-2">
        <Button
          type="submit"
          disabled={submitting}
          data-testid={`${testIdPrefix}-submit-button`}
        >
          {submitting ? <Loader2Icon className="animate-spin" aria-hidden="true" /> : null}
          {isEdit ? tCommon("save") : t("submitCreate")}
        </Button>
        {onCancel ? (
          <Button type="button" variant="outline" disabled={submitting} onClick={onCancel}>
            {tCommon("cancel")}
          </Button>
        ) : null}
      </div>
    </form>
  );
}
