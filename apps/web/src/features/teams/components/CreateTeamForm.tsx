"use client";

import { Alert, Button, Form, Input } from "antd";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";

import { teamSettingsHref } from "@/lib/routes";

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
  const t = useTranslations("teams");
  const tCommon = useTranslations("common");
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

      router.push(teamSettingsHref(result.data.slug));
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
        <Alert type="error" showIcon title={formError} className="mb-5" role="alert" />
      ) : null}

      <Form form={form} layout="vertical" requiredMark={false} onFinish={handleFinish} disabled={submitting}>
        <Form.Item
          label={t("nameLabel")}
          name="name"
          rules={[{ required: true, message: t("nameRequired") }]}
        >
          <Input data-testid="team-name-input" size="large" placeholder={t("namePlaceholder")} maxLength={30} autoFocus />
        </Form.Item>

        <Button type="primary" htmlType="submit" size="large" block loading={submitting} data-testid="create-team-button">
          {t("createTitle")}
        </Button>
      </Form>
    </div>
  );
}
