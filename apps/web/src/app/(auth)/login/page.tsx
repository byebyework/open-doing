import type { Metadata } from "next";

import { LoginForm } from "@/features/auth/components/LoginForm";

export const metadata: Metadata = {
  title: "登录 · Open Doing",
};

/** 登录页：左侧品牌侧板由 (auth)/layout.tsx 提供，本页只渲染表单列。 */
export default function LoginPage() {
  return <LoginForm />;
}
