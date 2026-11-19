"use client";

import type { Project, TagWithUsage } from "@open-doing/types";
import { zodResolver } from "@hookform/resolvers/zod";
import { CharCounter } from "@/components/ui/CharCounter";
import { DatePicker } from "@/components/ui/date-picker";
import { TagManagerButton } from "@/features/tags/components/TagManagerButton";
import {
  PROJECT_DESCRIPTION_MAX_LENGTH,
  PROJECT_NAME_MAX_LENGTH,
} from "../constants";
import { Loader2Icon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";

import { Alert } from "@/components/ui/shadcn/alert";
import { Button } from "@/components/ui/shadcn/button";
import { Input } from "@/components/ui/shadcn/input";
import { Label } from "@/components/ui/shadcn/label";
import { Textarea } from "@/components/ui/shadcn/textarea";
import { teamProjectHref } from "@/lib/routes";

import { applyActionErrors } from "@/lib/action-form";

import {
  createTeamProjectAction,
  updateTeamProjectAction,
} from "../actions";

/** 团队项目表单入参：传 `project` 即编辑态，否则新建。 */
export interface TeamProjectFormProps {
  teamId: string;
  project?: {
    id: string;
    name: string;
    description?: string;
    startDate?: string | null;
    endDate?: string | null;
  };
  /** 本团队标签池（RSC 注入；编辑态在表单底部提供「管理标签」入口）。 */
  tagPool?: TagWithUsage[];
  /** 成功后回调（页面跳转 / 弹窗关闭由调用方决定）。 */
  onSuccess: (project: Project) => void;
  /** 取消（编辑弹窗内使用）。 */
  onCancel?: () => void;
}

/**
 * 团队项目表单（新建与编辑共用）。
 *
 * 字段错误按 `field` 回填到表单项，表单级错误用 `Alert` 展示；
 * 提交中禁用表单，避免重复创建。
 */
export function TeamProjectForm({
  teamId,
  project,
  onSuccess,
  onCancel,
  tagPool,
}: TeamProjectFormProps) {
  const t = useTranslations("projects");
  const tCommon = useTranslations("common");
  const [submitting, setSubmitting] = useState(false);
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

  const onSubmit = handleSubmit(async (values) => {
    setSubmitting(true);
    setFormError(null);

    try {
      const result = project
        ? await updateTeamProjectAction({
            teamId,
            projectId: project.id,
            name: values.name,
            description: values.description ?? "",
            startDate: values.startDate.trim() ? values.startDate : null,
            endDate: values.endDate.trim() ? values.endDate : null,
          })
        : await createTeamProjectAction({
            teamId,
            name: values.name,
            description: values.description ?? "",
            startDate: values.startDate.trim() ? values.startDate : null,
            endDate: values.endDate.trim() ? values.endDate : null,
          });

      if (!result.ok) {
        applyActionErrors(result.errors, {
          setFieldError: (name, message) =>
            setError(name as keyof FormValues, { message }),
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
        <Alert variant="destructive" role="alert" className="mb-4">
          {formError}
        </Alert>
      ) : null}

      <div className="mb-4 flex flex-col gap-2">
        <Label htmlFor="team-project-name">{t("nameLabel")}</Label>
        <Input
          id="team-project-name"
          type="text"
          data-testid="team-project-name-input"
          placeholder={t("namePlaceholder")}
          maxLength={50}
          autoFocus
          aria-invalid={errors.name ? true : undefined}
          aria-describedby={errors.name ? "team-project-name-error" : undefined}
          disabled={submitting}
          {...register("name")}
        />
        <CharCounter value={nameValue} max={PROJECT_NAME_MAX_LENGTH} />
          {errors.name ? (
          <p id="team-project-name-error" className="text-[12.5px] text-[var(--error)]">
            {errors.name.message}
          </p>
        ) : null}
      </div>

      <div className="mb-4 flex flex-col gap-2">
        <Label htmlFor="team-project-description">{t("descriptionLabel")}</Label>
        <Textarea
          id="team-project-description"
          rows={4}
          placeholder={t("descriptionPlaceholder")}
          maxLength={500}
          aria-invalid={errors.description ? true : undefined}
          aria-describedby={
            errors.description ? "team-project-description-error" : undefined
          }
          disabled={submitting}
          {...register("description")}
        />
        <CharCounter value={descriptionValue} max={PROJECT_DESCRIPTION_MAX_LENGTH} />
          {errors.description ? (
          <p id="team-project-description-error" className="text-[12.5px] text-[var(--error)]">
            {errors.description.message}
          </p>
        ) : null}
      </div>

      {/* 起止时间（可选，两列排布；end < start 由服务层校验并回填 endDate 错误）。 */}
      <div className="mb-4 grid grid-cols-2 gap-4">
        <div className="flex flex-col gap-2">
          <Label htmlFor="team-project-start-date">{t("startDate")}</Label>
          <Controller
            control={control}
            name="startDate"
            render={({ field }) => (
              <DatePicker
                id="team-project-start-date"
                testid="team-project-start-date"
                value={field.value ?? ""}
                onChange={field.onChange}
                disabled={submitting}
              />
            )}
          />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="team-project-end-date">{t("endDate")}</Label>
          <Controller
            control={control}
            name="endDate"
            render={({ field }) => (
              <DatePicker
                id="team-project-end-date"
                testid="team-project-end-date"
                value={field.value ?? ""}
                onChange={field.onChange}
                disabled={submitting}
                invalid={errors.endDate ? true : undefined}
              />
            )}
          />
          {errors.endDate ? (
            <p id="team-project-end-date-error" className="text-[12.5px] text-[var(--error)]">
              {errors.endDate.message}
            </p>
          ) : null}
        </div>
      </div>

      <div className="flex gap-2">
        <Button type="submit" disabled={submitting} data-testid="team-project-submit-button">
          {submitting ? <Loader2Icon className="animate-spin" aria-hidden="true" /> : null}
          {isEdit ? tCommon("save") : t("submitCreate")}
        </Button>
        {onCancel ? (
          <Button type="button" variant="outline" disabled={submitting} onClick={onCancel}>
            {tCommon("cancel")}
          </Button>
        ) : null}
        {isEdit && tagPool ? (
          <TagManagerButton
            space={{ kind: "team", teamId }}
            initialTags={tagPool}
            canManage
          />
        ) : null}
      </div>
    </form>
  );
}

/**
 * 「新建项目」页的 client 包装件：成功后跳到新项目页。
 */
export function TeamProjectCreatePanel({
  teamId,
  teamSlug,
}: {
  teamId: string;
  teamSlug: string;
}) {
  const router = useRouter();
  const t = useTranslations("projects");

  return (
    <TeamProjectForm
      teamId={teamId}
      onSuccess={(project) => {
        toast.success(t("projectCreated"));
        router.push(teamProjectHref(teamSlug, project.slug));
        router.refresh();
      }}
    />
  );
}
