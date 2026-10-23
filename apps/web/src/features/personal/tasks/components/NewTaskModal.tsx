"use client";

import { Alert, Form, Input, Modal, Select, message } from "antd";
import { useState } from "react";

import { createPersonalTaskAction } from "../actions";

/** 新建任务弹窗入参。 */
export interface NewTaskModalProps {
  /** 是否显示。 */
  open: boolean;
  /** 可选的个人项目（「个人空间 / <项目名>」）。 */
  projects: { id: string; name: string }[];
  /** 默认选中的项目；缺省或不在列表中时选中「不属于项目」。 */
  defaultProjectId?: string | null;
  /** 创建成功后回调（由调用方关闭弹窗并刷新数据）。 */
  onSuccess: () => void;
  /** 取消 / 关闭。 */
  onCancel: () => void;
}

interface FormValues {
  title: string;
  projectId: string;
  dueDate?: string;
  description?: string;
}

/** 服务端可能返回的字段错误键。 */
const FIELD_KEYS = ["title", "projectId", "dueDate", "description"] as const;

type FieldKey = (typeof FIELD_KEYS)[number];

/**
 * 新建任务弹窗（个人空间）。
 *
 * 文案逐字对照 `personal-project.html`「新建任务」弹窗：无责任人字段，
 * 项目下拉 = 传入项目 + 末项「个人空间 · 不属于项目」。
 */
export function NewTaskModal({
  open,
  projects,
  defaultProjectId,
  onSuccess,
  onCancel,
}: NewTaskModalProps) {
  const [form] = Form.useForm<FormValues>();
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const defaultProject =
    defaultProjectId &&
    projects.some((project) => project.id === defaultProjectId)
      ? defaultProjectId
      : "";

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
    setSubmitting(true);
    setFormError(null);

    try {
      const result = await createPersonalTaskAction({
        title: values.title,
        description: values.description ?? "",
        dueDate: values.dueDate?.trim() ? values.dueDate : null,
        projectId: values.projectId ? values.projectId : null,
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

      message.success("任务已创建");
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
      title="新建任务"
      okText="创建任务"
      cancelText="取消"
      confirmLoading={submitting}
      onOk={() => form.submit()}
      onCancel={onCancel}
      afterOpenChange={handleOpenChange}
      destroyOnHidden
      width={520}
    >
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
          title: "",
          projectId: defaultProject,
          dueDate: "",
          description: "",
        }}
        onFinish={handleFinish}
        disabled={submitting}
      >
        <Form.Item
          label="标题"
          name="title"
          rules={[
            { required: true, whitespace: true, message: "请输入任务标题" },
            { max: 200, message: "任务标题不能超过 200 个字符" },
          ]}
        >
          <Input placeholder="任务要做什么？" maxLength={200} autoFocus />
        </Form.Item>

        <Form.Item label="所属空间 / 项目" name="projectId">
          <Select
            options={[
              ...projects.map((project) => ({
                value: project.id,
                label: `个人空间 / ${project.name}`,
              })),
              { value: "", label: "个人空间 · 不属于项目" },
            ]}
          />
        </Form.Item>

        <Form.Item label="截止日期" name="dueDate">
          <Input type="date" style={{ maxWidth: 220 }} />
        </Form.Item>

        <Form.Item label="描述" name="description">
          <Input.TextArea rows={4} placeholder="补充背景、验收标准…" />
        </Form.Item>
      </Form>
    </Modal>
  );
}
