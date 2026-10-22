import type { Metadata } from "next";

import { RegisterForm } from "@/features/auth/components/RegisterForm";

export const metadata: Metadata = {
  title: "注册 · Open Doing",
};

/** 注册页：左侧品牌侧板由 (auth)/layout.tsx 提供，本页只渲染表单列。 */
export default function RegisterPage() {
  return <RegisterForm />;
}
