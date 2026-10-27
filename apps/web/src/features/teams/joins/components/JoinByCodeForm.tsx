"use client";

import { Alert, Button, Form, Input, message } from "antd";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { createJoinRequestAction } from "../actions";

interface JoinValues {
  code: string;
}

/**
 * 凭码加入表单（客户端交互层）：输入 8 位团队加入码发起审批申请。
 *
 * 码的格式、存在性与重复申请校验在 server action（service 侧统一 trim + 大写）；
 * 错误按字段落回输入框 / 表单顶部，成功后重置输入并引导到邀请页查看进度。
 */
export function JoinByCodeForm() {
  const router = useRouter();
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

      message.success("申请已提交，等待管理员审批");
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

      <Form
        form={form}
        layout="vertical"
        requiredMark={false}
        onFinish={handleFinish}
        disabled={submitting}
      >
        <Form.Item
          label="团队加入码"
          name="code"
          rules={[{ required: true, message: "请输入团队加入码" }]}
          extra="向团队管理员索取 8 位加入码；提交后可在「待处理邀请」页查看审批进度。"
        >
          <Input
            size="large"
            placeholder="如 K7M29XQ4"
            maxLength={8}
            spellCheck={false}
            autoComplete="off"
            autoFocus
          />
        </Form.Item>

        <Button type="primary" size="large" htmlType="submit" loading={submitting}>
          提交申请
        </Button>
      </Form>

      <p className="mt-5 text-[13px] text-[#5f6368]">
        提交后可在{" "}
        <Link href="/invites" className="font-semibold text-[#7d2ae8]">
          待处理邀请
        </Link>{" "}
        页查看审批状态。
      </p>
    </div>
  );
}
