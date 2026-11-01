import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";

import { LoginForm } from "@/features/auth/components/LoginForm";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("meta");

  return { title: t("loginTitle") };
}

/** 登录页：左侧品牌侧板由 (auth)/layout.tsx 提供，本页只渲染表单列。 */
export default function LoginPage() {
  return <LoginForm />;
}
