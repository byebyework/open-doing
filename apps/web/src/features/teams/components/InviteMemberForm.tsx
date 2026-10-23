"use client";

import { Alert, Button, Form, Input, message } from "antd";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { createInviteAction } from "../invites/actions";

interface InviteValues {
  uid: string;
}

/**
 * 邀请成员表单（客户端交互层）：输入对方 UID 即可邀请。
 *
 * 输入框带 `doing_` 前缀，用户只填后缀（对照 team-settings 原型）；
 * 校验与错误文案（「UID 无效」等）在 server action。
 */
export function InviteMemberForm({ teamId }: { teamId: string }) {
  const router = useRouter();
  const [form] = Form.useForm<InviteValues>();
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  async function handleFinish(values: InviteValues) {
    setSubmitting(true);
    setFormError(null);

    try {
      const result = await createInviteAction({
        teamId,
        actorId: "",
        uid: `doing_${values.uid.trim()}`,
      });

      if (!result.ok) {
        if (result.errors.uid) {
          form.setFields([{ name: "uid", errors: [result.errors.uid] }]);
        }
        if (result.errors.form) setFormError(result.errors.form);
        return;
      }

      message.success("已发送邀请");
      form.resetFields();
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
        <Alert type="error" showIcon title={formError} className="mb-4" role="alert" />
      ) : null}

      <Form form={form} layout="vertical" requiredMark={false} onFinish={handleFinish} disabled={submitting}>
        <Form.Item
          label="对方 UID"
          name="uid"
          rules={[{ required: true, message: "请输入 UID 后缀" }]}
          extra="UID 必须属于已注册用户；不允许对同一人重复发起待处理邀请。"
        >
          <Input addonBefore="doing_" placeholder="输入 UID 后缀，如 x7k2m9" maxLength={6} autoFocus />
        </Form.Item>

        <Button type="primary" htmlType="submit" loading={submitting}>
          发送邀请
        </Button>
      </Form>
    </div>
  );
}
