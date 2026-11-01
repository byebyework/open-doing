"use client";

import { App, Alert, Button, Form, Input } from "antd";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
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
  const { message } = App.useApp();
  const router = useRouter();
  const t = useTranslations("teams");
  const tCommon = useTranslations("common");
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

      message.success(t("inviteSent"));
      form.resetFields();
      router.refresh();
    } catch {
      setFormError(tCommon("networkError"));
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
          label={t("uidLabel")}
          name="uid"
          rules={[{ required: true, message: t("uidRequired") }]}
          extra={t("uidExtra")}
        >
          <Input data-testid="invite-uid-input" prefix="doing_" placeholder={t("uidPlaceholder")} maxLength={6} autoFocus />
        </Form.Item>

        <Button type="primary" htmlType="submit" loading={submitting} data-testid="invite-send-button">
          {t("sendInvite")}
        </Button>
      </Form>
    </div>
  );
}
