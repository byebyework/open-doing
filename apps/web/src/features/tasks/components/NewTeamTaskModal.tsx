"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2Icon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";

import { Alert } from "@/components/ui/shadcn/alert";
import { Button } from "@/components/ui/shadcn/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/shadcn/dialog";
import { Input } from "@/components/ui/shadcn/input";
import { Label } from "@/components/ui/shadcn/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/shadcn/select";
import { Textarea } from "@/components/ui/shadcn/textarea";
import { applyActionErrors } from "@/lib/action-form";

import { createTeamTaskAction } from "../actions";

/** 新建团队任务弹窗入参。 */
export interface NewTeamTaskModalProps {
  /** 是否显示。 */
  open: boolean;
  teamId: string;
  /** 可选的团队项目（**仅本团队**；不提供个人空间选项）。 */
  projects: { id: string; name: string }[];
  /** 默认选中的项目（当前项目页传当前项目 ID）。 */
  defaultProjectId?: string | null;
  /** 可指派的团队成员。 */
  members: { id: string; name: string }[];
  /** 默认责任人（通常为当前用户）。 */
  defaultAssigneeId?: string | null;
  /** 创建成功后回调（由调用方关闭弹窗并刷新数据）。 */
  onSuccess: () => void;
  /** 取消 / 关闭。 */
  onCancel: () => void;
}

/**
 * 新建团队任务弹窗。
 *
 * 对照 `project-list.html`「新建任务」弹窗：项目下拉只列本团队项目
 * （控制器裁决：不提供个人空间选项），责任人下拉为团队成员、默认自己。
 * RHF 状态挂在常驻包装件上，Radix Dialog 关闭即卸载内容，打开时重置
 * 表单以还原 antd `resetFields` 语义。
 */
export function NewTeamTaskModal({
  open,
  teamId,
  projects,
  defaultProjectId,
  members,
  defaultAssigneeId,
  onSuccess,
  onCancel,
}: NewTeamTaskModalProps) {
  const t = useTranslations("tasks");
  const tCommon = useTranslations("common");
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const defaultProject =
    defaultProjectId &&
    projects.some((project) => project.id === defaultProjectId)
      ? defaultProjectId
      : (projects[0]?.id ?? "");

  const defaultAssignee =
    defaultAssigneeId &&
    members.some((member) => member.id === defaultAssigneeId)
      ? defaultAssigneeId
      : (members[0]?.id ?? "");

  // zod schema 在组件内构建：必填文案取自 next-intl。
  const schema = z.object({
    title: z
      .string()
      .trim()
      .min(1, t("titleRequired"))
      .max(200, t("titleTooLong", { max: 200 })),
    projectId: z.string().min(1, t("projectRequired")),
    assigneeId: z.string(),
    dueDate: z.string(),
    description: z.string(),
  });
  type FormValues = z.infer<typeof schema>;

  const {
    register,
    handleSubmit,
    setError,
    setValue,
    watch,
    reset,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      title: "",
      projectId: defaultProject,
      assigneeId: defaultAssignee,
      dueDate: "",
      description: "",
    },
  });

  // 每次打开都重置为初始值（关闭期间内容被卸载，但 RHF 状态常驻）。
  useEffect(() => {
    if (open) {
      reset({
        title: "",
        projectId: defaultProject,
        assigneeId: defaultAssignee,
        dueDate: "",
        description: "",
      });
      setFormError(null);
    }
  }, [open, reset, defaultProject, defaultAssignee]);

  const onSubmit = handleSubmit(async (values) => {
    setSubmitting(true);
    setFormError(null);

    try {
      const result = await createTeamTaskAction({
        teamId,
        projectId: values.projectId,
        title: values.title,
        description: values.description ?? "",
        dueDate: values.dueDate.trim() ? values.dueDate : null,
        assigneeId: values.assigneeId || null,
      });

      if (!result.ok) {
        applyActionErrors(result.errors, {
          setFieldError: (name, message) =>
            setError(name as keyof FormValues, { message }),
          onFormError: setFormError,
        });
        return;
      }

      toast.success(t("taskCreated"));
      onSuccess();
    } catch {
      setFormError(tCommon("networkError"));
    } finally {
      setSubmitting(false);
    }
  });

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onCancel();
      }}
    >
      <DialogContent className="sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle>{t("newTaskTitle")}</DialogTitle>
        </DialogHeader>

        {formError ? (
          <Alert variant="destructive" role="alert" className="mb-4">
            {formError}
          </Alert>
        ) : null}

        <form onSubmit={onSubmit} noValidate>
          <div className="mb-4 flex flex-col gap-2">
            <Label htmlFor="team-task-title">{t("title")}</Label>
            <Input
              id="team-task-title"
              type="text"
              data-testid="task-title-input"
              placeholder={t("titlePlaceholder")}
              maxLength={200}
              autoFocus
              aria-invalid={errors.title ? true : undefined}
              aria-describedby={errors.title ? "team-task-title-error" : undefined}
              disabled={submitting}
              {...register("title")}
            />
            {errors.title ? (
              <p id="team-task-title-error" className="text-[12.5px] text-[var(--error)]">
                {errors.title.message}
              </p>
            ) : null}
          </div>

          <div className="mb-4 flex flex-col gap-2">
            <Label htmlFor="team-task-project">{t("projectLabel")}</Label>
            <Select
              value={watch("projectId")}
              onValueChange={(value) => setValue("projectId", value)}
            >
              <SelectTrigger
                id="team-task-project"
                className="w-full"
                data-testid="task-project-select"
                aria-invalid={errors.projectId ? true : undefined}
                disabled={submitting}
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {projects.map((project) => (
                  <SelectItem key={project.id} value={project.id}>
                    {project.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {errors.projectId ? (
              <p className="text-[12.5px] text-[var(--error)]">
                {errors.projectId.message}
              </p>
            ) : null}
          </div>

          <div className="mb-4 flex flex-col gap-2">
            <Label htmlFor="team-task-assignee">{t("assigneeLabel")}</Label>
            <Select
              value={watch("assigneeId")}
              onValueChange={(value) => setValue("assigneeId", value)}
            >
              <SelectTrigger
                id="team-task-assignee"
                className="w-full"
                disabled={submitting}
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {members.map((member) => (
                  <SelectItem key={member.id} value={member.id}>
                    {member.id === defaultAssigneeId
                      ? t("memberSelf", { name: member.name })
                      : member.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-[12.5px] text-[#9aa0a6]">{t("assigneeHelp")}</p>
          </div>

          <div className="mb-4 flex flex-col gap-2">
            <Label htmlFor="team-task-due-date">{t("dueDateLabel")}</Label>
            <Input
              id="team-task-due-date"
              type="date"
              className="max-w-[220px]"
              data-testid="task-due-date-input"
              disabled={submitting}
              {...register("dueDate")}
            />
          </div>

          <div className="mb-4 flex flex-col gap-2">
            <Label htmlFor="team-task-description">{t("descriptionLabel")}</Label>
            <Textarea
              id="team-task-description"
              rows={4}
              placeholder={t("descriptionPlaceholder")}
              disabled={submitting}
              {...register("description")}
            />
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" disabled={submitting} onClick={onCancel}>
              {tCommon("cancel")}
            </Button>
            <Button type="submit" disabled={submitting} data-testid="task-create-submit-button">
              {submitting ? <Loader2Icon className="animate-spin" aria-hidden="true" /> : null}
              {t("okCreateTask")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
