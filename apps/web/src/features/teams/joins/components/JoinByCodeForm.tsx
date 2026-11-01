"use client";

import { Alert, Button, Form, Input, message } from "antd";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";

import { invitesHref } from "@/lib/routes";

import { createJoinRequestAction } from "../actions";

interface JoinValues {
  code: string;
}

/**
 * 凭码加入表单（客户端交互层）：输入 8 位团队加入码发起审批申请。
 *
 * 码的格式、存在性与重复申请校验在 server action（service 侧剔除空白 + 大写）；
 * 错误按字段落回输入框 / 表单顶部，成功后重置输入并引导到邀请页查看进度。
 */
export function JoinByCodeForm() {
  const router = useRouter();
  const t = useTranslations("teams");
  const tCommon = useTranslations("common");
  const [form] = Form.useForm<JoinValues>();
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  async function handleFinish(values: JoinValues) {
    setSubmitting(true);
    setFormError(null);

    try {
      const result = await createJoinRequestAction({ code: values.code });

      if (!result.ok) {
        if (result.errors.code) {
          form.setFields([{ name: "code", errors: [result.errors.code] }]);
        }
        if (result.errors.form) setFormError(result.errors.form);
        return;
      }

      message.success(t("joinSubmitted"));
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

      <Form
        form={form}
        layout="vertical"
        requiredMark={false}
        onFinish={handleFinish}
        disabled={submitting}
      >
        <Form.Item
          label={t("joinCodeLabel")}
          name="code"
          rules={[{ required: true, message: t("joinCodeRequired") }]}
          extra={t("joinCodeHint")}
        >
          <Input
            data-testid="join-code-input"
            size="large"
            placeholder={t("joinCodePlaceholder")}
            spellCheck={false}
            autoComplete="off"
            autoFocus
          />
        </Form.Item>

        <Button type="primary" size="large" htmlType="submit" loading={submitting} data-testid="join-submit-button">
          {t("submitRequest")}
        </Button>
      </Form>

      <p className="mt-5 text-[13px] text-[#5f6368]">
        {t("trackBefore")}{" "}
        <Link href={invitesHref()} className="font-semibold text-[#7d2ae8]">
          {t("invitesTitle")}
        </Link>{" "}
        {t("trackAfter")}
      </p>
    </div>
  );
}
