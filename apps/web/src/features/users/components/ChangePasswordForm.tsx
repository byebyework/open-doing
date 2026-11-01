"use client";

import { App, Alert, Button, Form, Input } from "antd";
import { useTranslations } from "next-intl";
import { useState } from "react";

import { changePasswordAction } from "@/features/auth/actions";
import { PASSWORD_MIN_LENGTH } from "@/features/auth/constants";

interface ChangePasswordValues {
  oldPassword: string;
  newPassword: string;
  confirmPassword: string;
}

/**
 * 修改密码表单（个人设置页客户端交互层）。
 *
 * 文案对照 `space-settings-personal.html`「账户安全」卡片。确认密码只在
 * 前端校验；服务端 `AuthError.field` 映射回旧密码 / 新密码输入框，
 * 表单级错误显示在顶部。修改成功后不登出（无状态会话保持不变）。
 */
export function ChangePasswordForm() {
  const { message } = App.useApp();
  const t = useTranslations("settings");
  const tCommon = useTranslations("common");
  const [form] = Form.useForm<ChangePasswordValues>();
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  async function handleFinish(values: ChangePasswordValues) {
    setSubmitting(true);
    setFormError(null);
    // 清掉上一次提交留下的服务端字段错误，避免旧错误残留在别的输入框。
    form.setFields([
      { name: "oldPassword", errors: [] },
      { name: "newPassword", errors: [] },
      { name: "confirmPassword", errors: [] },
    ]);

    try {
      const result = await changePasswordAction({
        oldPassword: values.oldPassword,
        newPassword: values.newPassword,
      });

      if (!result.ok) {
        const fieldErrors: {
          name: "oldPassword" | "newPassword";
          errors: string[];
        }[] = [];

        if (result.errors.oldPassword) {
          fieldErrors.push({
            name: "oldPassword",
            errors: [result.errors.oldPassword],
          });
        }
        if (result.errors.newPassword) {
          fieldErrors.push({
            name: "newPassword",
            errors: [result.errors.newPassword],
          });
        }
        if (fieldErrors.length > 0) form.setFields(fieldErrors);
        if (result.errors.form) setFormError(result.errors.form);
        return;
      }

      message.success(t("passwordUpdated"));
      form.resetFields();
    } catch {
      setFormError(tCommon("networkError"));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div>
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
        onFinish={handleFinish}
        disabled={submitting}
        className="max-w-[460px]"
      >
        <Form.Item
          label={t("oldPassword")}
          name="oldPassword"
          rules={[{ required: true, message: t("oldPasswordRequired") }]}
        >
          <Input.Password
            data-testid="settings-old-password-input"
            placeholder={t("oldPasswordPlaceholder")}
            autoComplete="current-password"
          />
        </Form.Item>

        <Form.Item
          label={t("newPassword")}
          name="newPassword"
          rules={[
            { required: true, message: t("newPasswordRequired") },
            { min: PASSWORD_MIN_LENGTH, message: t("passwordMinLength", { min: PASSWORD_MIN_LENGTH }) },
          ]}
        >
          <Input.Password data-testid="settings-new-password-input" placeholder={t("newPasswordPlaceholder", { min: PASSWORD_MIN_LENGTH })} autoComplete="new-password" />
        </Form.Item>

        <Form.Item
          label={t("confirmPassword")}
          name="confirmPassword"
          dependencies={["newPassword"]}
          rules={[
            { required: true, message: t("confirmPasswordRequired") },
            ({ getFieldValue }) => ({
              validator(_rule, value: string) {
                if (!value || getFieldValue("newPassword") === value) {
                  return Promise.resolve();
                }
                return Promise.reject(new Error(t("passwordMismatch")));
              },
            }),
          ]}
        >
          <Input.Password
            data-testid="settings-confirm-password-input"
            placeholder={t("confirmPasswordPlaceholder")}
            autoComplete="new-password"
          />
        </Form.Item>

        <div className="flex flex-wrap items-center gap-3">
          <Button type="primary" htmlType="submit" loading={submitting} data-testid="settings-update-password-button">
            {t("updatePassword")}
          </Button>
          <span className="text-[12px] text-[#9aa0a6]">
            {t("keepLoggedInHint")}
          </span>
        </div>
      </Form>
    </div>
  );
}
