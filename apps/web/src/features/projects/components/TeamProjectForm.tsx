"use client";

import type { Project } from "@open-doing/types";
import { Alert, Button, Form, Input, message } from "antd";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { teamProjectHref } from "@/lib/routes";

import {
  createTeamProjectAction,
  updateTeamProjectAction,
} from "../actions";

/** 表单字段名（与 Service Action 的错误键一致）。 */
const FIELD_KEYS = ["name", "description"] as const;

type FieldKey = (typeof FIELD_KEYS)[number];

interface FormValues {
  name: string;
  description?: string;
}

/** 团队项目表单入参：传 `project` 即编辑态，否则新建。 */
export interface TeamProjectFormProps {
  teamId: string;
  project?: { id: string; name: string; description?: string };
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
}: TeamProjectFormProps) {
  const t = useTranslations("projects");
  const tCommon = useTranslations("common");
  const [form] = Form.useForm<FormValues>();
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const isEdit = Boolean(project);

  async function handleFinish(values: FormValues) {
    setSubmitting(true);
    setFormError(null);

    try {
      const result = project
        ? await updateTeamProjectAction({
            teamId,
            projectId: project.id,
            name: values.name,
            description: values.description ?? "",
          })
        : await createTeamProjectAction({
            teamId,
            name: values.name,
            description: values.description ?? "",
          });

      if (!result.ok) {
        const fieldErrors: { name: FieldKey; errors: string[] }[] = [];

        for (const key of FIELD_KEYS) {
          const messageText = result.errors[key];
          if (messageText) {
            fieldErrors.push({ name: key, errors: [messageText] });
          }
        }

        if (fieldErrors.length > 0) form.setFields(fieldErrors);
        if (result.errors.form) setFormError(result.errors.form);
        return;
      }

      onSuccess(result.data);
    } catch {
      setFormError(tCommon("networkError"));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Form
      form={form}
      layout="vertical"
      requiredMark={false}
      disabled={submitting}
      initialValues={{
        name: project?.name ?? "",
        description: project?.description ?? "",
      }}
      onFinish={handleFinish}
    >
      {formError ? (
        <Alert type="error" showIcon title={formError} className="mb-4" role="alert" />
      ) : null}

      <Form.Item
        label={t("nameLabel")}
        name="name"
        rules={[
          { required: true, whitespace: true, message: t("nameRequired") },
          { max: 50, message: t("nameTooLong", { max: 50 }) },
        ]}
      >
        <Input placeholder={t("namePlaceholder")} maxLength={50} autoFocus />
      </Form.Item>

      <Form.Item
        label={t("descriptionLabel")}
        name="description"
        rules={[{ max: 500, message: t("descriptionTooLong", { max: 500 }) }]}
      >
        <Input.TextArea rows={4} placeholder={t("descriptionPlaceholder")} maxLength={500} />
      </Form.Item>

      <div className="flex gap-2">
        <Button type="primary" htmlType="submit" loading={submitting}>
          {isEdit ? tCommon("save") : t("submitCreate")}
        </Button>
        {onCancel ? <Button onClick={onCancel}>{tCommon("cancel")}</Button> : null}
      </div>
    </Form>
  );
}

/**
 * 「新建项目」页的 client 包装件：成功后跳到新项目页。
 *
 * 项目页在 J-3 落地；此前跳转目标暂为 404（轨道内已知的过渡态）。
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
        message.success(t("projectCreated"));
        router.push(teamProjectHref(teamSlug, project.slug));
        router.refresh();
      }}
    />
  );
}
