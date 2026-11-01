import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";

import { RegisterForm } from "@/features/auth/components/RegisterForm";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("meta");

  return { title: t("registerTitle") };
}

/** 注册页：左侧品牌侧板由 (auth)/layout.tsx 提供，本页只渲染表单列。 */
export default function RegisterPage() {
  return <RegisterForm />;
}
