"use client";

import { Alert, Button, Form, Input } from "antd";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";

import { spaceDashboardHref } from "@/lib/routes";

import { registerAction } from "../actions";
import {
  PASSWORD_MIN_LENGTH,
  USERNAME_MAX_LENGTH,
  USERNAME_MIN_LENGTH,
} from "../constants";

interface RegisterValues {
  username: string;
  password: string;
  confirmPassword: string;
}

/**
 * 注册表单（客户端交互层）。
 *
 * 确认密码只在前端校验；服务端 action 只接收用户名 + 密码。
 * 注册成功后 action 写入会话 cookie，页面直接进入个人空间首页。
 */
export function RegisterForm() {
  const router = useRouter();
  const t = useTranslations("auth");
  const tCommon = useTranslations("common");
  const [form] = Form.useForm<RegisterValues>();
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  async function handleFinish(values: RegisterValues) {
    setSubmitting(true);
    setFormError(null);

    try {
      const result = await registerAction({
        username: values.username,
        password: values.password,
      });

      if (!result.ok) {
        const fieldErrors: {
          name: "username" | "password";
          errors: string[];
        }[] = [];

        if (result.errors.username) {
          fieldErrors.push({ name: "username", errors: [result.errors.username] });
        }
        if (result.errors.password) {
          fieldErrors.push({ name: "password", errors: [result.errors.password] });
        }
        if (fieldErrors.length > 0) form.setFields(fieldErrors);
        if (result.errors.form) setFormError(result.errors.form);
        return;
      }

      router.push(spaceDashboardHref("personal"));
      router.refresh();
    } catch {
      setFormError(tCommon("networkError"));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div>
      <span
        className="grid h-10 w-10 place-items-center rounded-xl bg-[linear-gradient(135deg,#7d2ae8_0%,#00c4cc_100%)] text-[19px] font-extrabold text-white"
        aria-hidden="true"
      >
        O
      </span>

      <h1 className="mb-2 mt-5 text-[26px] font-extrabold tracking-[-0.01em] text-[#0e1318]">
        {t("createAccount")}
      </h1>
      <p className="mb-6 text-[14px] text-[#5f6368]">{t("registerSubtitle")}</p>

      {formError ? (
        <Alert
          type="error"
          showIcon
          title={formError}
          className="mb-5"
          role="alert"
        />
      ) : null}

      <Form
        form={form}
        layout="vertical"
        requiredMark={false}
        onFinish={handleFinish}
        disabled={submitting}
      >
        <Form.Item
          label={t("usernameLabel")}
          name="username"
          extra={t("usernameExtra", {
            min: USERNAME_MIN_LENGTH,
            max: USERNAME_MAX_LENGTH,
          })}
          rules={[
            { required: true, message: t("usernameRequired") },
            {
              min: USERNAME_MIN_LENGTH,
              message: t("usernameLength", {
                min: USERNAME_MIN_LENGTH,
                max: USERNAME_MAX_LENGTH,
              }),
            },
            {
              max: USERNAME_MAX_LENGTH,
              message: t("usernameLength", {
                min: USERNAME_MIN_LENGTH,
                max: USERNAME_MAX_LENGTH,
              }),
            },
          ]}
        >
          <Input
            size="large"
            placeholder={t("usernameRegisterPlaceholder")}
            data-testid="auth-username-input"
            autoComplete="username"
            autoFocus
          />
        </Form.Item>

        <Form.Item
          label={t("passwordLabel")}
          name="password"
          rules={[
            { required: true, message: t("passwordRequired") },
            {
              min: PASSWORD_MIN_LENGTH,
              message: t("passwordMinLength", { min: PASSWORD_MIN_LENGTH }),
            },
          ]}
        >
          <Input.Password
            size="large"
            placeholder={t("passwordRegisterPlaceholder")}
            data-testid="auth-password-input"
            autoComplete="new-password"
          />
        </Form.Item>

        <Form.Item
          label={t("confirmPasswordLabel")}
          name="confirmPassword"
          dependencies={["password"]}
          rules={[
            { required: true, message: t("confirmPasswordRequired") },
            ({ getFieldValue }) => ({
              validator(_rule, value: string) {
                if (!value || getFieldValue("password") === value) {
                  return Promise.resolve();
                }
                return Promise.reject(new Error(t("passwordMismatch")));
              },
            }),
          ]}
        >
          <Input.Password
            size="large"
            placeholder={t("confirmPasswordPlaceholder")}
            data-testid="auth-password-confirm-input"
            autoComplete="new-password"
          />
        </Form.Item>

        <div className="mb-5 flex gap-2 rounded-lg bg-[#eaf5ff] px-4 py-3 text-[12.5px] leading-[1.5] text-[#0b6fb8]">
          <span aria-hidden="true">ℹ</span>
          <span>
            {t("uidHintBefore")}{" "}
            <b className="font-mono">doing_xxxx</b>{" "}
            {t("uidHintAfter")}
          </span>
        </div>

        <Button
          type="primary"
          htmlType="submit"
          size="large"
          block
          loading={submitting}
          data-testid="auth-submit-button"
          style={{
            background: "linear-gradient(135deg,#7d2ae8 0%,#00c4cc 100%)",
            border: "none",
            color: "#fff",
            fontWeight: 600,
          }}
        >
          {t("signUpButton")}
        </Button>
      </Form>

      <p className="mt-5 text-center text-[13px] text-[#5f6368]">
        {t("hasAccount")}{" "}
        <Link href="/login" className="font-semibold text-[#7d2ae8]">
          {t("signInInstead")}
        </Link>
      </p>
    </div>
  );
}
