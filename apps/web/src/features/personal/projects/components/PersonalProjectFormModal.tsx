"use client";

import { Alert, Form, Input, Modal, message } from "antd";
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

/** 原型中的可见性说明（逐字）。 */
const INFO_TEXT =
  "个人项目仅你自己可见，与团队项目相互独立；项目中的任务同样会汇总到「我的任务」。";

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
      setFormError("缺少项目信息");
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

      message.success(mode === "edit" ? "项目已保存" : "项目已创建");
      onSuccess();
    } catch {
      setFormError("网络异常，请稍后重试");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal
      open={open}
      title={mode === "create" ? "新建个人项目" : "编辑项目"}
      okText={mode === "create" ? "创建项目" : "保存"}
      cancelText="取消"
      confirmLoading={submitting}
      onOk={() => form.submit()}
      onCancel={onCancel}
      afterOpenChange={handleOpenChange}
      destroyOnHidden
      width={480}
    >
      <Alert type="info" showIcon title={INFO_TEXT} className="mb-5" />

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
          label="项目名称"
          name="name"
          rules={[
            { required: true, whitespace: true, message: "请输入项目名称" },
            { max: 50, message: "项目名称不能超过 50 个字符" },
          ]}
        >
          <Input
            placeholder="例如：学习成长、装修、求职准备"
            maxLength={50}
            autoFocus
          />
        </Form.Item>

        <Form.Item
          label="描述（可选）"
          name="description"
          rules={[{ max: 500, message: "描述不能超过 500 个字符" }]}
        >
          <Input.TextArea
            rows={4}
            placeholder="这个项目用来归集什么事？"
            maxLength={500}
            showCount
          />
        </Form.Item>
      </Form>
    </Modal>
  );
}
