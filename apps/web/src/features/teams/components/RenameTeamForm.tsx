"use client";

import { Alert, Button, Form, Input, message } from "antd";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";

import { renameTeamAction } from "../actions";

interface RenameTeamValues {
  name: string;
}

/**
 * 团队改名表单（客户端交互层）。
 *
 * slug 不随改名变化；校验与权限在 server action 端再校验。
 */
export function RenameTeamForm({ teamId, name }: { teamId: string; name: string }) {
  const router = useRouter();
  const t = useTranslations("teams");
  const tCommon = useTranslations("common");
  const [form] = Form.useForm<RenameTeamValues>();
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  async function handleFinish(values: RenameTeamValues) {
    setSubmitting(true);
    setFormError(null);

    try {
      const result = await renameTeamAction({ teamId, name: values.name });

      if (!result.ok) {
        if (result.errors.name) {
          form.setFields([{ name: "name", errors: [result.errors.name] }]);
        }
        if (result.errors.form) setFormError(result.errors.form);
        return;
      }

      message.success(t("saved"));
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

      <Form
        form={form}
        layout="vertical"
        requiredMark={false}
        initialValues={{ name }}
        onFinish={handleFinish}
        disabled={submitting}
      >
        <Form.Item
          label={t("nameLabel")}
          name="name"
          rules={[{ required: true, message: t("nameRequired") }]}
        >
          <Input placeholder={t("nameLabel")} maxLength={30} />
        </Form.Item>

        <Button type="primary" htmlType="submit" size="small" loading={submitting}>
          {t("saveChanges")}
        </Button>
      </Form>
    </div>
  );
}
