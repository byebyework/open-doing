"use client";

import type { Project, Tag, TaskPriority } from "@open-doing/types";
import { zodResolver } from "@hookform/resolvers/zod";
import { CharCounter } from "@/components/ui/CharCounter";
import { DatePicker } from "@/components/ui/date-picker";
import { TaskTagPicker } from "@/features/tags/components/TaskTagPicker";
import { FlagIcon, Loader2Icon, XIcon } from "lucide-react";
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

/**
 * 团队/个人共用项目表单（新建与编辑）。
 *
 * 字段：名称、描述、起止时间、优先级（三档 segmented，默认「中」）、
 * 项目标签（空池不渲染）、里程碑编辑器（仅新建）。服务端校验失败按
 * field 回填，里程碑错误（field "milestones"）落表单级错误位。
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
        projectTagPool.length > 0 && tagIds.length > 0 ? tagIds : undefined,
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

  return (
    <form onSubmit={onSubmit} noValidate>
      {formError ? (
        <div
          role="alert"
          data-testid={`${testIdPrefix}-form-error`}
          className="mb-4 rounded-[var(--radius-md)] border border-[var(--error)] bg-[var(--error-muted,var(--error))]/10 px-3 py-2 text-[12.5px] text-[var(--error)]"
        >
          {formError}
        </div>
      ) : null}

      <div className="mb-4 flex flex-col gap-2">
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

      <div className="mb-4 flex flex-col gap-2">
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
      <div className="mb-4 grid grid-cols-2 gap-4">
        <div className="flex flex-col gap-2">
          <Label htmlFor={`${testIdPrefix}-start-date`}>{t("startDate")}</Label>
          <Controller
            control={control}
            name="startDate"
            render={({ field }) => (
              <DatePicker
                id={`${testIdPrefix}-start-date`}
                testid={`${testIdPrefix}-start-date`}
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
              <DatePicker
                id={`${testIdPrefix}-end-date`}
                testid={`${testIdPrefix}-end-date`}
                value={field.value ?? ""}
                onChange={field.onChange}
                disabled={submitting}
                invalid={errors.endDate ? true : undefined}
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
      <div className="mb-4 flex flex-col gap-2">
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
              {t(
                value === "high"
                  ? "priorityHighLabel"
                  : value === "medium"
                    ? "priorityMediumLabel"
                    : "priorityLowLabel",
              )}
            </Button>
          ))}
        </div>
      </div>

      {projectTagPool.length > 0 ? (
        <div className="mb-4 flex flex-col gap-2">
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

      {/* 里程碑编辑器：仅新建（编辑态统一在详情页管理，避免双编辑入口）。 */}
      {!isEdit ? (
        <div className="mb-4 flex flex-col gap-2">
          <ProjectMilestoneEditor
            onSubmit={addMilestone}
            submitting={submitting}
            testIdPrefix={testIdPrefix}
          />
          {milestones.length > 0 ? (
            <div className="flex flex-col gap-2">
              <p className="text-[13px] text-[var(--muted-foreground)]">
                {t("milestoneAddedTitle")}
              </p>
              {milestones.map((item, index) => (
                <div
                  key={item.key}
                  data-testid={`${testIdPrefix}-milestone-item`}
                  className="flex items-center gap-2 rounded-[var(--radius-md)] border border-[var(--border)] px-3 py-2"
                >
                  <FlagIcon className="size-3.5 text-[var(--brand)]" aria-hidden="true" />
                  <span className="text-[13px] font-medium">{item.name}</span>
                  <span className="text-[12.5px] text-[var(--muted-foreground)]">
                    {item.dueDate}
                  </span>
                  <button
                    type="button"
                    aria-label={t("milestoneRemove")}
                    data-testid={`${testIdPrefix}-milestone-remove-${index}`}
                    disabled={submitting}
                    onClick={() => removeMilestone(item.key)}
                    className="ml-auto text-[var(--muted-foreground)] hover:text-[var(--error)]"
                  >
                    <XIcon className="size-3.5" aria-hidden="true" />
                  </button>
                </div>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="flex gap-2">
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
