"use client";

import { Alert, Button, Form, Input } from "antd";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { loginAction } from "../actions";

interface LoginValues {
  username: string;
  password: string;
}

/**
 * 登录表单（客户端交互层）。
 *
 * 校验为交互体验兜底，真正的认证与恒定错误文案在 server action。
 * 成功后写入 httpOnly 会话 cookie，再导航到 /my。
 */
export function LoginForm() {
  const router = useRouter();
  const [form] = Form.useForm<LoginValues>();
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  async function handleFinish(values: LoginValues) {
    setSubmitting(true);
    setFormError(null);

    try {
      const result = await loginAction({
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

      router.push("/my");
      router.refresh();
    } catch {
      setFormError("网络异常，请稍后重试");
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
        欢迎回来
      </h1>
      <p className="mb-7 text-[14px] text-[#5f6368]">登录你的 Open Doing 账号</p>

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
          label="用户名"
          name="username"
          rules={[{ required: true, message: "请输入用户名" }]}
        >
          <Input
            size="large"
            placeholder="请输入用户名"
            autoComplete="username"
            autoFocus
          />
        </Form.Item>

        <Form.Item
          label="密码"
          name="password"
          rules={[{ required: true, message: "请输入密码" }]}
        >
          <Input.Password
            size="large"
            placeholder="请输入密码"
            autoComplete="current-password"
          />
        </Form.Item>

        <div className="-mt-1 mb-4 flex justify-end">
          <span className="text-[12px] text-[#9aa0a6]">v1 暂不支持找回密码</span>
        </div>

        <Button
          type="primary"
          htmlType="submit"
          size="large"
          block
          loading={submitting}
          style={{
            background: "linear-gradient(135deg,#7d2ae8 0%,#00c4cc 100%)",
            border: "none",
            color: "#fff",
            fontWeight: 600,
          }}
        >
          登 录
        </Button>
      </Form>

      <p className="mt-5 text-center text-[13px] text-[#5f6368]">
        还没有账号？{" "}
        <Link href="/register" className="font-semibold text-[#7d2ae8]">
          立即注册
        </Link>
      </p>
    </div>
  );
}
