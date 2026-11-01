"use client";

import { Alert, Button, Form, Input, message } from "antd";
import { useState } from "react";

import { changePasswordAction } from "@/features/auth/actions";
import { PASSWORD_MIN_LENGTH } from "@/features/auth/constants";

interface ChangePasswordValues {
  oldPassword: string;
  newPassword: string;
  confirmPassword: string;
}

const PASSWORD_LENGTH_MESSAGE = `新密码至少 ${PASSWORD_MIN_LENGTH} 位`;

/**
 * 修改密码表单（个人设置页客户端交互层）。
 *
 * 文案对照 `space-settings-personal.html`「账户安全」卡片。确认密码只在
 * 前端校验；服务端 `AuthError.field` 映射回旧密码 / 新密码输入框，
 * 表单级错误显示在顶部。修改成功后不登出（无状态会话保持不变）。
 */
export function ChangePasswordForm() {
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

      message.success("密码已更新");
      form.resetFields();
    } catch {
      setFormError("网络异常，请稍后重试");
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
          label="旧密码"
          name="oldPassword"
          rules={[{ required: true, message: "请输入旧密码" }]}
        >
          <Input.Password
            placeholder="输入当前密码"
            autoComplete="current-password"
          />
        </Form.Item>

        <Form.Item
          label="新密码"
          name="newPassword"
          rules={[
            { required: true, message: "请输入新密码" },
            { min: PASSWORD_MIN_LENGTH, message: PASSWORD_LENGTH_MESSAGE },
          ]}
        >
          <Input.Password placeholder="至少 8 位" autoComplete="new-password" />
        </Form.Item>

        <Form.Item
          label="确认新密码"
          name="confirmPassword"
          dependencies={["newPassword"]}
          rules={[
            { required: true, message: "请再次输入新密码" },
            ({ getFieldValue }) => ({
              validator(_rule, value: string) {
                if (!value || getFieldValue("newPassword") === value) {
                  return Promise.resolve();
                }
                return Promise.reject(new Error("两次输入的新密码不一致"));
              },
            }),
          ]}
        >
          <Input.Password
            placeholder="再次输入新密码"
            autoComplete="new-password"
          />
        </Form.Item>

        <div className="flex flex-wrap items-center gap-3">
          <Button type="primary" htmlType="submit" loading={submitting}>
            更新密码
          </Button>
          <span className="text-[12px] text-[#9aa0a6]">
            更新后保持登录状态；下次登录请使用新密码。
          </span>
        </div>
      </Form>
    </div>
  );
}
