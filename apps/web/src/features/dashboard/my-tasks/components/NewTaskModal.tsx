"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { TASK_PRIORITIES, type TaskPriority } from "@open-doing/types";
import { Loader2Icon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
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
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/shadcn/select";
import { Textarea } from "@/components/ui/shadcn/textarea";
import { priorityLabelKey } from "@/components/ui/PriorityChip";
import { applyActionErrors } from "@/lib/action-form";
import { createPersonalTaskAction } from "@/features/personal/tasks/actions";
import {
  TASK_DESCRIPTION_MAX_LENGTH,
  TASK_TITLE_MAX_LENGTH,
} from "@/features/personal/tasks/service";
import { createTeamTaskAction } from "@/features/tasks/actions";

import type { CrossSpaceProjectOption } from "../service";

/** 新建任务弹窗入参（项目来自跨空间聚合：个人项目 + 本人所在团队项目）。 */
export interface NewTaskModalProps {
  /** 是否显示。 */
  open: boolean;
  /** 可选项目；个人项目（teamId = null）排在前，团队项目按团队分组。 */
  projects: CrossSpaceProjectOption[];
  /** 创建成功后回调（由调用方关闭弹窗并刷新数据）。 */
  onSuccess: () => void;
  /** 取消 / 关闭。 */
  onCancel: () => void;
}

/** 「不属于项目」在 Radix Select 里的哨兵值（不允许空字符串 item value）。 */
const NO_PROJECT = "__none__";

/**
 * 把跨空间项目选项整理成 Radix Select 的分组结构。
 *
 * 服务端已保证个人项目在前、团队项目按团队名排序；这里只按 teamId
 * 分组并保留原顺序，个人空间固定为第一组。
 */
function buildProjectGroups(
  projects: CrossSpaceProjectOption[],
  t: (key: "teamGroupLabel" | "personalSpaceGroup" | "noProjectOption") => string,
): { label: string; options: { value: string; label: string }[] }[] {
  const personal = projects.filter((project) => project.teamId === null);
  const teamGroups = new Map<
    string,
    { label: string; options: { value: string; label: string }[] }
  >();

  for (const project of projects) {
    if (project.teamId === null) continue;

    const key = project.teamId;
    const group = teamGroups.get(key) ?? {
      label: project.teamName ?? t("teamGroupLabel"),
      options: [],
    };
    group.options.push({
      value: project.projectId,
      label: project.projectName,
    });
    teamGroups.set(key, group);
  }

  return [
    {
      label: t("personalSpaceGroup"),
      options: [
        { value: NO_PROJECT, label: t("noProjectOption") },
        ...personal.map((project) => ({
          value: project.projectId,
          label: project.projectName,
        })),
      ],
    },
    ...teamGroups.values(),
  ];
}

/**
 * 跨空间新建任务弹窗。
 *
 * 对照 `my-tasks.html`「新建任务」弹窗：项目下拉同时列出个人项目、
 * 「不属于项目」与各团队项目（按团队分组）。提交时按所选项目的
 * teamId 分流到对应的 Server Action；团队任务的默认责任人即创建者。
 * RHF 状态挂在常驻包装件上，Radix Dialog 在退出保持窗口（约 200ms）结束后
 * 卸载内容，打开时重置表单以还原 antd `resetFields` 语义。
 */
export function NewTaskModal({
  open,
  projects,
  onSuccess,
  onCancel,
}: NewTaskModalProps) {
  const t = useTranslations("tasks");
  const tCommon = useTranslations("common");
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // zod schema 在组件内构建:必填文案取自 next-intl。
  const schema = z.object({
    title: z
      .string()
      .trim()
      .min(1, t("titleRequired"))
      .max(TASK_TITLE_MAX_LENGTH, t("titleTooLong", { max: TASK_TITLE_MAX_LENGTH })),
    projectId: z.string(),
    priority: z.string(),
    dueDate: z.string(),
    startDate: z.string(),
    description: z
      .string()
      .refine(
        (value) => value.trim().length <= TASK_DESCRIPTION_MAX_LENGTH,
        t("descriptionTooLong", { max: TASK_DESCRIPTION_MAX_LENGTH }),
      ),
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
      projectId: NO_PROJECT,
      priority: "medium",
      dueDate: "",
      startDate: "",
      description: "",
    },
  });

  // 每次打开都重置为初始值（关闭期间内容被卸载，但 RHF 状态常驻）。
  useEffect(() => {
    if (open) {
      reset({
        title: "",
        projectId: NO_PROJECT,
        priority: "medium",
        dueDate: "",
        startDate: "",
        description: "",
      });
      setFormError(null);
    }
  }, [open, reset]);

  const projectGroups = buildProjectGroups(projects, t);

  const onSubmit = handleSubmit(async (values) => {
    // 成功分支会关闭弹窗，但内容在退出保持窗口（约 200ms）内仍可交互；
    // 期间按钮恢复可点/可回车提交，这里按 open 作幂等闸门避免重复创建。
    if (!open) return;
    setSubmitting(true);
    setFormError(null);

    const selectedProjectId =
      values.projectId === NO_PROJECT ? null : values.projectId;

    try {
      const selected =
        selectedProjectId === null
          ? null
          : (projects.find(
              (project) => project.projectId === selectedProjectId,
            ) ?? null);
      const dueDate = values.dueDate.trim() ? values.dueDate : null;
      const startDate = values.startDate.trim() ? values.startDate : null;
      const description = values.description ?? "";
      const priority = values.priority as TaskPriority;

      const result =
        selected && selected.teamId !== null
          ? await createTeamTaskAction({
              teamId: selected.teamId,
              projectId: selected.projectId,
              title: values.title,
              description,
              priority,
              dueDate,
              startDate,
            })
          : await createPersonalTaskAction({
              projectId: selectedProjectId,
              title: values.title,
              description,
              priority,
              dueDate,
              startDate,
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
            <Label htmlFor="dashboard-task-title">{t("title")}</Label>
            <Input
              id="dashboard-task-title"
              type="text"
              placeholder={t("titlePlaceholder")}
              maxLength={TASK_TITLE_MAX_LENGTH}
              autoFocus
              aria-invalid={errors.title ? true : undefined}
              aria-describedby={errors.title ? "dashboard-task-title-error" : undefined}
              disabled={submitting}
              {...register("title")}
            />
            {errors.title ? (
              <p id="dashboard-task-title-error" className="text-[12.5px] text-[var(--error)]">
                {errors.title.message}
              </p>
            ) : null}
          </div>

          <div className="mb-4 flex flex-col gap-2">
            <Label>{t("spaceProjectLabel")}</Label>
            <Select
              value={watch("projectId")}
              onValueChange={(value) => setValue("projectId", value)}
            >
              <SelectTrigger className="w-full" data-testid="task-project-select">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {projectGroups.map((group) => (
                  <SelectGroup key={group.label}>
                    <SelectLabel>{group.label}</SelectLabel>
                    {group.options.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="mb-4 flex flex-col gap-2">
            <Label>{t("priority")}</Label>
            <Select
              value={watch("priority")}
              onValueChange={(value) => setValue("priority", value)}
            >
              <SelectTrigger className="w-full" data-testid="task-priority-select">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TASK_PRIORITIES.map((candidate) => (
                  <SelectItem key={candidate} value={candidate}>
                    {t(priorityLabelKey(candidate))}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* 开始 / 截止同行排布（两列）。 */}
          <div className="mb-4 grid grid-cols-2 gap-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="dashboard-task-start-date">{t("startDateLabel")}</Label>
              <Input
                id="dashboard-task-start-date"
                type="date"
                aria-invalid={errors.startDate ? true : undefined}
                disabled={submitting}
                {...register("startDate")}
              />
              {errors.startDate ? (
                <p className="text-[12.5px] text-[var(--error)]">
                  {errors.startDate.message}
                </p>
              ) : null}
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="dashboard-task-due-date">{t("dueDateLabel")}</Label>
              <Input
                id="dashboard-task-due-date"
                type="date"
                aria-invalid={errors.dueDate ? true : undefined}
                disabled={submitting}
                {...register("dueDate")}
              />
              {errors.dueDate ? (
                <p className="text-[12.5px] text-[var(--error)]">
                  {errors.dueDate.message}
                </p>
              ) : null}
            </div>
          </div>

          <div className="mb-4 flex flex-col gap-2">
            <Label htmlFor="dashboard-task-description">
              {t("descriptionLabel")}
            </Label>
            <Textarea
              id="dashboard-task-description"
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
            <Button type="submit" disabled={submitting}>
              {submitting ? <Loader2Icon className="animate-spin" aria-hidden="true" /> : null}
              {t("okCreateTask")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** 「我的任务」页顶部的新建任务入口：按钮 + 弹窗 + 成功刷新。 */
export function NewTaskButton({
  projects,
}: {
  projects: CrossSpaceProjectOption[];
}) {
  const router = useRouter();
  const t = useTranslations("tasks");
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button onClick={() => setOpen(true)}>
        {t("newTaskButton")}
      </Button>

      <NewTaskModal
        open={open}
        projects={projects}
        onSuccess={() => {
          setOpen(false);
          router.refresh();
        }}
        onCancel={() => setOpen(false)}
      />
    </>
  );
}
