"use client";

import { Alert, Button, Form, Input, Modal, Select, message } from "antd";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { createPersonalTaskAction } from "@/features/personal/tasks/actions";
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

interface FormValues {
  title: string;
  /** 空字符串表示个人空间下「不属于项目」。 */
  projectId?: string;
  dueDate?: string;
  description?: string;
}

/** 服务端可能返回的字段错误键。 */
const FIELD_KEYS = ["title", "projectId", "dueDate", "description"] as const;

type FieldKey = (typeof FIELD_KEYS)[number];

interface ProjectSelectGroup {
  label: string;
  options: { value: string; label: string }[];
}

/**
 * 把跨空间项目选项整理成 antd Select 的分组结构。
 *
 * 服务端已保证个人项目在前、团队项目按团队名排序；这里只按 teamId
 * 分组并保留原顺序，个人空间固定为第一组。
 */
function buildProjectGroups(
  projects: CrossSpaceProjectOption[],
): ProjectSelectGroup[] {
  const personal = projects.filter((project) => project.teamId === null);
  const teamGroups = new Map<string, ProjectSelectGroup>();

  for (const project of projects) {
    if (project.teamId === null) continue;

    const key = project.teamId;
    const group = teamGroups.get(key) ?? {
      label: project.teamName ?? "团队",
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
      label: "个人空间",
      options: [
        { value: "", label: "不属于项目" },
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
 */
export function NewTaskModal({
  open,
  projects,
  onSuccess,
  onCancel,
}: NewTaskModalProps) {
  const [form] = Form.useForm<FormValues>();
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const projectGroups = buildProjectGroups(projects);

  /** `destroyOnHidden` 卸载表单后，下次打开按 `initialValues` 重新挂载。 */
  function handleOpenChange(visible: boolean) {
    if (!visible) return;
    setFormError(null);
    form.resetFields();
  }

  async function handleFinish(values: FormValues) {
    setSubmitting(true);
    setFormError(null);

    try {
      const selected =
        projects.find((project) => project.projectId === values.projectId) ??
        null;
      const dueDate = values.dueDate?.trim() ? values.dueDate : null;
      const description = values.description ?? "";

      const result =
        selected && selected.teamId !== null
          ? await createTeamTaskAction({
              teamId: selected.teamId,
              projectId: selected.projectId,
              title: values.title,
              description,
              dueDate,
            })
          : await createPersonalTaskAction({
              projectId: values.projectId ? values.projectId : null,
              title: values.title,
              description,
              dueDate,
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

        // 未绑定到具体字段的错误（含 form / teamId 等）统一展示在表单顶部。
        const formMessage =
          result.errors.form ??
          Object.entries(result.errors).find(
            ([key]) => key !== "form" && !FIELD_KEYS.includes(key as FieldKey),
          )?.[1];
        if (formMessage) setFormError(formMessage);
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
          projectId: "",
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
          <Select options={projectGroups} />
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

/** 「我的任务」页顶部的新建任务入口：按钮 + 弹窗 + 成功刷新。 */
export function NewTaskButton({
  projects,
}: {
  projects: CrossSpaceProjectOption[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button type="primary" onClick={() => setOpen(true)}>
        ＋ 新建任务
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
