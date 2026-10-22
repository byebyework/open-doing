"use client";

import { Alert, Button, Form, Input } from "antd";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { createTeamAction } from "../actions";

interface CreateTeamValues {
  name: string;
}

/**
 * 创建团队表单（客户端交互层）。
 *
 * 校验为交互体验兜底，真正的校验与错误文案在 server action；
 * 成功后导航到团队设置页并刷新服务端数据（侧栏即时出现新团队）。
 */
export function CreateTeamForm() {
  const router = useRouter();
  const [form] = Form.useForm<CreateTeamValues>();
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  async function handleFinish(values: CreateTeamValues) {
    setSubmitting(true);
    setFormError(null);

    try {
      const result = await createTeamAction({ name: values.name });

      if (!result.ok) {
        if (result.errors.name) {
          form.setFields([{ name: "name", errors: [result.errors.name] }]);
        }
        if (result.errors.form) setFormError(result.errors.form);
        return;
      }

      router.push(`/teams/${result.data.slug}/settings`);
      router.refresh();
    } catch {
      setFormError("网络异常，请稍后重试");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div>
      {formError ? (
        <Alert type="error" showIcon title={formError} className="mb-5" role="alert" />
      ) : null}

      <Form form={form} layout="vertical" requiredMark={false} onFinish={handleFinish} disabled={submitting}>
        <Form.Item
          label="团队名称"
          name="name"
          rules={[{ required: true, message: "请输入团队名称" }]}
        >
          <Input size="large" placeholder="如：增长突击队" maxLength={30} autoFocus />
        </Form.Item>

        <Button type="primary" htmlType="submit" size="large" block loading={submitting}>
          创建团队
        </Button>
      </Form>
    </div>
  );
}
