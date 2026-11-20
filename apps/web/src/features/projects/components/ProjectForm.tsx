"use client";

import type { Project, Tag, TaskPriority } from "@open-doing/types";
import { zodResolver } from "@hookform/resolvers/zod";
import { CharCounter } from "@/components/ui/CharCounter";
import { Calendar } from "@/components/ui/shadcn/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/shadcn/popover";
import { TaskTagPicker, TagOptionList } from "@/features/tags/components/TaskTagPicker";
import {
  CalendarPlusIcon,
  FlagIcon,
  Loader2Icon,
  PlusIcon,
  TagIcon,
  XIcon,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { z } from "zod";

import { Button } from "@/components/ui/shadcn/button";
import { Input } from "@/components/ui/shadcn/input";
import { Label } from "@/components/ui/shadcn/label";
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
} from "../constants";
import { ProjectMilestoneEditor, type MilestoneDraftInput } from "./ProjectMilestoneEditor";

/** 表单服务的空间：团队（带 teamId）或个人。 */
export type ProjectFormSpace = { kind: "team"; teamId: string } | { kind: "personal" };

/** 编辑态项目入参：详情页/弹窗持有的 Project 均可直传。 */
export interface ProjectFormProject {
  id: string;
  name: string;
  description?: string;
  startDate?: string | null;
  endDate?: string | null;
  priority?: TaskPriority;
  tags?: Tag[];
}

export interface ProjectFormProps {
  space: ProjectFormSpace;
  /** 项目类型标签池（RSC 注入；空池不渲染标签区）。 */
  projectTagPool: Tag[];
  /** 编辑态传项目（不含里程碑编辑器）；新建不传。 */
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

/** 属性行 pill（Linear 式）：图标 + 标签 + 当前值，点击弹出轻量编辑层。 */
function AttrPill({
  testid,
  icon,
  label,
  value,
  valueActive,
  children,
  disabled,
}: {
  testid: string;
  icon: React.ReactNode;
  label: string;
  value?: string;
  valueActive?: boolean;
  children: (close: () => void) => React.ReactNode;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          data-testid={testid}
          disabled={disabled}
          className="inline-flex cursor-pointer items-center gap-1.5 rounded-full border border-[var(--border)] bg-[var(--card)] px-3 py-1.5 text-[13px] text-[var(--color-text)] transition-colors hover:bg-[var(--color-surface-hover)] disabled:opacity-50"
        >
          <span className="text-[var(--color-text-muted)]">{icon}</span>
          <span>{label}</span>
          {value ? (
            <span className={valueActive ? "font-medium text-[var(--color-primary)]" : "text-[var(--color-text-secondary)]"}>
              {value}
            </span>
          ) : null}
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-auto min-w-[180px] p-2">
        {children(() => setOpen(false))}
      </PopoverContent>
    </Popover>
  );
}

/**
 * 团队/个人共用项目表单（新建与编辑）。
 *
 * 新建态对照 Linear「New project」信息架构（用户 2026-11-20 参考）：大标题
 * 内联输入 + 简述行 + 属性行 pill（优先级/起止/标签）+ 里程碑折叠行；
 * 编辑态保持有标签字段布局。字段错误按 field 回填，里程碑错误
 * （field "milestones"）落表单级错误位。
 */
export function ProjectForm({
  space,
  projectTagPool,
  project,
  onSuccess,
  onCancel,
  testIdPrefix = "project",
  open = true,
}: ProjectFormProps) {
  const t = useTranslations("projects");
  const tTags = useTranslations("tags");
  const tCommon = useTranslations("common");
  const [submitting, setSubmitting] = useState(false);
  const [priority, setPriority] = useState<TaskPriority>(project?.priority ?? "medium");
  const [tagIds, setTagIds] = useState<string[]>(project?.tags?.map((tag) => tag.id) ?? []);
  const [milestones, setMilestones] = useState<MilestoneDraft[]>([]);
  const [milestoneAdding, setMilestoneAdding] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const isEdit = Boolean(project);

  // zod schema 在组件内构建：长度文案取自 next-intl。
  const schema = z.object({
    name: z
      .string()
      .trim()
      .min(1, t("nameRequired"))
      .max(50, t("nameTooLong", { max: 50 })),
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
  };

  const removeMilestone = (key: string) => {
    setMilestones((current) => current.filter((item) => item.key !== key));
  };

  const onSubmit = handleSubmit(async (values) => {
    // Radix exit-hold：关闭（含退出保持窗口）后不可再提交。
    if (!open || submitting) return;
    setSubmitting(true);
    setFormError(null);

    const base = {
      name: values.name,
      description: values.description ?? "",
      startDate: values.startDate.trim() ? values.startDate : null,
      endDate: values.endDate.trim() ? values.endDate : null,
      priority,
      tagIds:
        projectTagPool.length > 0 ? tagIds : undefined,
      milestones:
        !isEdit && milestones.length > 0
          ? milestones.map(({ name, description, dueDate }) => ({
              name,
              description,
              dueDate,
            }))
          : undefined,
    };

    try {
      const result = space.kind === "team"
        ? isEdit
          ? await updateTeamProjectAction({
              teamId: space.teamId,
              projectId: project!.id,
              name: base.name,
              description: base.description,
              startDate: base.startDate,
              endDate: base.endDate,
              priority: base.priority,
              tagIds: base.tagIds,
            })
          : await createTeamProjectAction({
              teamId: space.teamId,
              name: base.name,
              description: base.description,
              startDate: base.startDate,
              endDate: base.endDate,
              priority: base.priority,
              tagIds: base.tagIds,
              milestones: base.milestones,
            })
        : isEdit
          ? await updatePersonalProjectAction(project!.id, {
              name: base.name,
              description: base.description,
              startDate: base.startDate,
              endDate: base.endDate,
              priority: base.priority,
              tagIds: base.tagIds,
            })
          : await createPersonalProjectAction({
              name: base.name,
              description: base.description,
              startDate: base.startDate,
              endDate: base.endDate,
              priority: base.priority,
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
    t(value === "high" ? "priorityHighLabel" : value === "medium" ? "priorityMediumLabel" : "priorityLowLabel");

  const milestoneList = !isEdit ? (
    <div className="mt-2 flex flex-col gap-2">
      {milestones.map((item, index) => (
        <div
          key={item.key}
          data-testid={`${testIdPrefix}-milestone-item`}
          className="flex items-center gap-2 rounded-[var(--radius-md)] border border-[var(--border)] px-3 py-2"
        >
          <FlagIcon className="size-3.5 text-[var(--color-primary)]" aria-hidden="true" />
          <span className="text-[13px] font-medium">{item.name}</span>
          <span className="text-[12.5px] text-[var(--color-text-muted)]">{item.dueDate}</span>
          <button
            type="button"
            aria-label={t("milestoneRemove")}
            data-testid={`${testIdPrefix}-milestone-remove-${index}`}
            disabled={submitting}
            onClick={() => removeMilestone(item.key)}
            className="ml-auto text-[var(--color-text-muted)] hover:text-[var(--color-error)]"
          >
            <XIcon className="size-3.5" aria-hidden="true" />
          </button>
        </div>
      ))}
      {milestoneAdding ? (
        <ProjectMilestoneEditor
          onSubmit={(draft) => {
            addMilestone(draft);
            setMilestoneAdding(false);
          }}
          onCancel={() => setMilestoneAdding(false)}
          submitting={submitting}
          testIdPrefix={testIdPrefix}
        />
      ) : null}
    </div>
  ) : null;

  return (
    <form onSubmit={onSubmit} noValidate>
      {formError ? (
        <div
          role="alert"
          data-testid={`${testIdPrefix}-form-error`}
          className="mb-3 rounded-[var(--radius-md)] border border-[var(--error)] bg-[var(--error-muted,var(--error))]/10 px-3 py-2 text-[12.5px] text-[var(--error)]"
        >
          {formError}
        </div>
      ) : null}

      {isEdit ? (
        <>
          <div className="mb-3 flex flex-col gap-2">
            <Label htmlFor={`${testIdPrefix}-name`}>
              {t("nameLabel")} <span className="text-[var(--error)]">*</span>
            </Label>
            <Input
              id={`${testIdPrefix}-name`}
              type="text"
              data-testid={`${testIdPrefix}-name-input`}
              placeholder={t("namePlaceholder")}
              maxLength={50}
              autoFocus
              aria-invalid={errors.name ? true : undefined}
              aria-describedby={errors.name ? `${testIdPrefix}-name-error` : undefined}
              disabled={submitting}
              {...register("name")}
            />
            <CharCounter value={nameValue} max={PROJECT_NAME_MAX_LENGTH} />
            {errors.name ? (
              <p id={`${testIdPrefix}-name-error`} className="text-[12.5px] text-[var(--error)]">
                {errors.name.message}
              </p>
            ) : null}
          </div>

          <div className="mb-3 flex flex-col gap-2">
            <Label htmlFor={`${testIdPrefix}-description`}>{t("descriptionLabel")}</Label>
            <Textarea
              id={`${testIdPrefix}-description`}
              rows={3}
              placeholder={t("descriptionPlaceholder")}
              maxLength={500}
              aria-invalid={errors.description ? true : undefined}
              disabled={submitting}
              {...register("description")}
            />
            <CharCounter value={descriptionValue} max={PROJECT_DESCRIPTION_MAX_LENGTH} />
            {errors.description ? (
              <p className="text-[12.5px] text-[var(--error)]">
                {errors.description.message}
              </p>
            ) : null}
          </div>

          {/* 起止时间（可选，两列排布；end < start 由服务层校验并回填 endDate 错误）。 */}
          <div className="mb-3 grid grid-cols-2 gap-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor={`${testIdPrefix}-start-date`}>{t("startDate")}</Label>
              <Controller
                control={control}
                name="startDate"
                render={({ field }) => (
                  <Input
                    id={`${testIdPrefix}-start-date`}
                    type="date"
                    data-testid={`${testIdPrefix}-start-date`}
                    value={field.value ?? ""}
                    onChange={field.onChange}
                    disabled={submitting}
                  />
                )}
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor={`${testIdPrefix}-end-date`}>{t("endDate")}</Label>
              <Controller
                control={control}
                name="endDate"
                render={({ field }) => (
                  <Input
                    id={`${testIdPrefix}-end-date`}
                    type="date"
                    data-testid={`${testIdPrefix}-end-date`}
                    value={field.value ?? ""}
                    onChange={field.onChange}
                    disabled={submitting}
                    aria-invalid={errors.endDate ? true : undefined}
                  />
                )}
              />
              {errors.endDate ? (
                <p className="text-[12.5px] text-[var(--error)]">
                  {errors.endDate.message}
                </p>
              ) : null}
            </div>
          </div>

          {/* 优先级：三档 segmented，默认「中」。 */}
          <div className="mb-3 flex flex-col gap-2">
            <Label>{t("priorityLabel")}</Label>
            <div className="grid grid-cols-3 gap-2">
              {PRIORITIES.map(({ value, testidSuffix }) => (
                <Button
                  key={value}
                  type="button"
                  variant={priority === value ? "default" : "outline"}
                  aria-pressed={priority === value}
                  data-testid={`${testIdPrefix}-priority-${testidSuffix}`}
                  disabled={submitting}
                  onClick={() => setPriority(value)}
                >
                  {priorityLabel(value)}
                </Button>
              ))}
            </div>
          </div>

          {projectTagPool.length > 0 ? (
            <div className="mb-3 flex flex-col gap-2">
              <Label>{tTags("tagNameLabel")}</Label>
              <TaskTagPicker
                space={space.kind === "team" ? { kind: "team", teamId: space.teamId } : { kind: "personal" }}
                pool={projectTagPool}
                value={tagIds}
                onChange={setTagIds}
                canEdit={!submitting}
              />
            </div>
          ) : null}
        </>
      ) : (
        <>
          {/* Linear 式大标题内联输入（占位即标签；必填红点在提交层校验）。 */}
          <Input
            type="text"
            data-testid={`${testIdPrefix}-name-input`}
            placeholder={t("namePlaceholder")}
            maxLength={50}
            autoFocus
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

          {/* 简述行 = 项目描述（占位即标签）。 */}
          <Input
            type="text"
            data-testid={`${testIdPrefix}-description-input`}
            placeholder={t("descriptionPlaceholder")}
            maxLength={500}
            aria-invalid={errors.description ? true : undefined}
            disabled={submitting}
            className="h-auto border-none bg-transparent px-0 text-[14px] text-[var(--color-text-secondary)] shadow-none focus-visible:ring-0 dark:bg-transparent"
            {...register("description")}
          />
          {errors.description ? (
            <p className="mb-2 text-[12.5px] text-[var(--error)]">
              {errors.description.message}
            </p>
          ) : null}

          {/* 属性行 pill：优先级 / 开始 / 结束 / 标签（对照 Linear 属性行）。 */}
          <div className="my-3 flex flex-wrap items-center gap-2">
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
            {projectTagPool.length > 0 ? (
              <AttrPill
                testid={`${testIdPrefix}-labels-pill`}
                icon={<TagIcon className="size-3.5" aria-hidden="true" />}
                label={tTags("tagNameLabel")}
                value={tagIds.length > 0 ? String(tagIds.length) : undefined}
                disabled={submitting}
              >
                {(close) => (
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
            ) : null}
          </div>

          <div className="my-3 border-t border-[var(--border)]" />

          {/* 里程碑折叠行（对照 Linear「Milestones · + Add」）。 */}
          <div className="rounded-[var(--radius-lg)] border border-[var(--border)] px-4 py-3">
            <div className="flex items-center gap-2">
              <span className="text-[14px] font-medium">{t("milestoneLabel")}</span>
              {milestones.length > 0 ? (
                <span className="rounded-full bg-[var(--color-primary-bg)] px-2 py-0.5 text-[12px] font-medium text-[var(--color-primary)]">
                  {milestones.length}
                </span>
              ) : null}
              <Button
                type="button"
                variant="ghost"
                className="ml-auto"
                data-testid={`${testIdPrefix}-milestone-add-trigger`}
                disabled={submitting || milestoneAdding}
                onClick={() => setMilestoneAdding(true)}
              >
                <PlusIcon className="size-4" aria-hidden="true" />
                {t("milestoneAdd")}
              </Button>
            </div>
            {milestoneList}
          </div>
        </>
      )}

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
