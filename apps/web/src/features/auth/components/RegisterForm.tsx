"use client";

import { Alert, Button, Form, Input } from "antd";
import Link from "next/link";
import { useRouter } from "next/navigation";
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

const USERNAME_LENGTH_MESSAGE = `用户名需为 ${USERNAME_MIN_LENGTH}–${USERNAME_MAX_LENGTH} 个字符`;
const PASSWORD_LENGTH_MESSAGE = `密码至少 ${PASSWORD_MIN_LENGTH} 位`;

/**
 * 注册表单（客户端交互层）。
 *
 * 确认密码只在前端校验；服务端 action 只接收用户名 + 密码。
 * 注册成功后 action 写入会话 cookie，页面直接进入个人空间首页。
 */
export function RegisterForm() {
  const router = useRouter();
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
        创建账号
      </h1>
      <p className="mb-6 text-[14px] text-[#5f6368]">只需用户名和密码，无需邮箱</p>

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
          extra={`${USERNAME_MIN_LENGTH}–${USERNAME_MAX_LENGTH} 个字符，全局唯一，注册后用于登录与显示`}
          rules={[
            { required: true, message: "请输入用户名" },
            { min: USERNAME_MIN_LENGTH, message: USERNAME_LENGTH_MESSAGE },
            { max: USERNAME_MAX_LENGTH, message: USERNAME_LENGTH_MESSAGE },
          ]}
        >
          <Input
            size="large"
            placeholder="给自己起个名字，全局唯一"
            autoComplete="username"
            autoFocus
          />
        </Form.Item>

        <Form.Item
          label="密码"
          name="password"
          rules={[
            { required: true, message: "请输入密码" },
            { min: PASSWORD_MIN_LENGTH, message: PASSWORD_LENGTH_MESSAGE },
          ]}
        >
          <Input.Password
            size="large"
            placeholder="至少 8 位"
            autoComplete="new-password"
          />
        </Form.Item>

        <Form.Item
          label="确认密码"
          name="confirmPassword"
          dependencies={["password"]}
          rules={[
            { required: true, message: "请再次输入密码" },
            ({ getFieldValue }) => ({
              validator(_rule, value: string) {
                if (!value || getFieldValue("password") === value) {
                  return Promise.resolve();
                }
                return Promise.reject(new Error("两次输入的密码不一致"));
              },
            }),
          ]}
        >
          <Input.Password
            size="large"
            placeholder="再次输入密码"
            autoComplete="new-password"
          />
        </Form.Item>

        <div className="mb-5 flex gap-2 rounded-lg bg-[#eaf5ff] px-4 py-3 text-[12.5px] leading-[1.5] text-[#0b6fb8]">
          <span aria-hidden="true">ℹ</span>
          <span>
            注册成功后系统会自动生成形如{" "}
            <b className="font-mono">doing_xxxx</b>{" "}
            的专属 UID，队友通过 UID 邀请你加入团队。
          </span>
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
          注 册
        </Button>
      </Form>

      <p className="mt-5 text-center text-[13px] text-[#5f6368]">
        已有账号？{" "}
        <Link href="/login" className="font-semibold text-[#7d2ae8]">
          直接登录
        </Link>
      </p>
    </div>
  );
}
