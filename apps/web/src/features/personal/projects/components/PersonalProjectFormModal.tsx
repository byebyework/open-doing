"use client";

import { App, Alert, Form, Input, Modal } from "antd";
import { useTranslations } from "next-intl";
import { useState } from "react";

import {
  createPersonalProjectAction,
  updatePersonalProjectAction,
} from "../actions";

/** 表单弹窗入参（create 与 edit 共用）。 */
export interface PersonalProjectFormModalProps {
  /** 是否显示。 */
  open: boolean;
  /** 新建或编辑。 */
  mode: "create" | "edit";
  /** 编辑模式下的项目数据。 */
  project?: { id: string; name: string; description?: string };
  /** 提交成功后回调（由调用方关闭弹窗并刷新数据）。 */
  onSuccess: () => void;
  /** 取消 / 关闭。 */
  onCancel: () => void;
}

interface FormValues {
  name: string;
  description?: string;
}

interface FieldError {
  name: "name" | "description";
  errors: string[];
}

/**
 * 个人项目新建 / 编辑弹窗。
 *
 * 文案对照 `my-tasks.html`「新建个人项目」弹窗；服务端校验失败时
 * 把 `DomainError.field` 映射回对应表单项，表单级错误显示在顶部。
 */
export function PersonalProjectFormModal({
  open,
  mode,
  project,
  onSuccess,
  onCancel,
}: PersonalProjectFormModalProps) {
  const { message } = App.useApp();
  const t = useTranslations("personal");
  const tCommon = useTranslations("common");
  const [form] = Form.useForm<FormValues>();
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  /**
   * `destroyOnHidden` 会在关闭后卸载表单，下次打开时按 `initialValues`
   * 重新挂载；这里只需在打开后清掉上一次的表单级错误。
   */
  function handleOpenChange(visible: boolean) {
    if (!visible) return;
    setFormError(null);
    form.resetFields();
  }

  async function handleFinish(values: FormValues) {
    if (mode === "edit" && !project) {
      setFormError(t("missingProject"));
      return;
    }

    setSubmitting(true);
    setFormError(null);

    const input = {
      name: values.name,
      description: values.description ?? "",
    };

    try {
      const result =
        mode === "edit" && project
          ? await updatePersonalProjectAction(project.id, input)
          : await createPersonalProjectAction(input);

      if (!result.ok) {
        const fieldErrors: FieldError[] = [];
        if (result.errors.name) {
          fieldErrors.push({ name: "name", errors: [result.errors.name] });
        }
        if (result.errors.description) {
          fieldErrors.push({
            name: "description",
            errors: [result.errors.description],
          });
        }
        if (fieldErrors.length > 0) form.setFields(fieldErrors);
        if (result.errors.form) setFormError(result.errors.form);
        return;
      }

      message.success(mode === "edit" ? t("projectSaved") : t("projectCreated"));
      onSuccess();
    } catch {
      setFormError(tCommon("networkError"));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal
      open={open}
      title={mode === "create" ? t("modalTitleCreate") : t("modalTitleEdit")}
      okText={mode === "create" ? t("okCreate") : tCommon("save")}
      cancelText={tCommon("cancel")}
      confirmLoading={submitting}
      okButtonProps={{ "data-testid": "personal-project-submit-button" }}
      onOk={() => form.submit()}
      onCancel={onCancel}
      afterOpenChange={handleOpenChange}
      destroyOnHidden
      width={480}
    >
      <Alert type="info" showIcon title={t("infoText")} className="mb-5" />

      {formError ? (
        <Alert
          type="error"
          showIcon
          title={formError}
          className="mb-4"
          role="alert"
        />
      ) : null}

      <Form
        form={form}
        layout="vertical"
        requiredMark={false}
        initialValues={{
          name: mode === "edit" ? (project?.name ?? "") : "",
          description: mode === "edit" ? (project?.description ?? "") : "",
        }}
        onFinish={handleFinish}
        disabled={submitting}
      >
        <Form.Item
          label={t("nameLabel")}
          name="name"
          rules={[
            { required: true, whitespace: true, message: t("nameRequired") },
            { max: 50, message: t("nameTooLong", { max: 50 }) },
          ]}
        >
          <Input
            data-testid="personal-project-name-input"
            placeholder={t("namePlaceholder")}
            maxLength={50}
            autoFocus
          />
        </Form.Item>

        <Form.Item
          label={t("descriptionOptional")}
          name="description"
          rules={[{ max: 500, message: t("descriptionTooLong", { max: 500 }) }]}
        >
          <Input.TextArea
            rows={4}
            placeholder={t("descriptionPlaceholder")}
            maxLength={500}
            showCount
          />
        </Form.Item>
      </Form>
    </Modal>
  );
}
