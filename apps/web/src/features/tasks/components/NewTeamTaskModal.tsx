"use client";

import { Alert, Form, Input, Modal, Select, message } from "antd";
import { useState } from "react";

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

interface FormValues {
  title: string;
  projectId: string;
  assigneeId: string;
  dueDate?: string;
  description?: string;
}

/** 服务端可能返回的字段错误键。 */
const FIELD_KEYS = [
  "title",
  "projectId",
  "assigneeId",
  "dueDate",
  "description",
] as const;

type FieldKey = (typeof FIELD_KEYS)[number];

/**
 * 新建团队任务弹窗。
 *
 * 对照 `project-list.html`「新建任务」弹窗：项目下拉只列本团队项目
 * （控制器裁决：不提供个人空间选项），责任人下拉为团队成员、默认自己。
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
  const [form] = Form.useForm<FormValues>();
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

  /** 关闭后表单被卸载，下次打开按 `initialValues` 重新挂载。 */
  function handleOpenChange(visible: boolean) {
    if (!visible) return;
    setFormError(null);
    form.resetFields();
  }

  async function handleFinish(values: FormValues) {
    setSubmitting(true);
    setFormError(null);

    try {
      const result = await createTeamTaskAction({
        teamId,
        projectId: values.projectId,
        title: values.title,
        description: values.description ?? "",
        dueDate: values.dueDate?.trim() ? values.dueDate : null,
        assigneeId: values.assigneeId || null,
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
          assigneeId: defaultAssignee,
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

        <Form.Item
          label="所属项目"
          name="projectId"
          rules={[{ required: true, message: "请选择所属项目" }]}
        >
          <Select
            options={projects.map((project) => ({
              value: project.id,
              label: project.name,
            }))}
          />
        </Form.Item>

        <Form.Item
          label="责任人"
          name="assigneeId"
          help="可指派给团队内任意成员"
        >
          <Select
            options={members.map((member) => ({
              value: member.id,
              label:
                member.id === defaultAssigneeId
                  ? `${member.name}（我）`
                  : member.name,
            }))}
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
