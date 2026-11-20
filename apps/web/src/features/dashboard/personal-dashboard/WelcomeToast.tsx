"use client";

import { useTranslations } from "next-intl";
import { useEffect } from "react";
import { toast } from "sonner";

import { greetingKey, type GreetingKey } from "@/lib/today";

/** 登录欢迎标记的 sessionStorage key（LoginForm 成功路径写入）。 */
const WELCOME_FLAG = "od_welcome";

const GREETING_I18N: Record<GreetingKey, "welcomeMorning" | "welcomeAfternoon" | "welcomeEvening"> = {
  morning: "welcomeMorning",
  afternoon: "welcomeAfternoon",
  evening: "welcomeEvening",
};

/** WelcomeToast 入参：展示名（昵称优先回退用户名）。 */
export interface WelcomeToastProps {
  name: string;
}

/**
 * 登录欢迎 toast：LoginForm 成功路径写入 sessionStorage 标记，
 * 落地仪表盘后消费一次（toast 后即清除——每次登录只出现一次）。
 * 时段按 Asia/Shanghai 口径计算（greetingKey，UTC+8 显式偏移）。
 */
export function WelcomeToast({ name }: WelcomeToastProps) {
  const t = useTranslations("dashboard");

  useEffect(() => {
    if (sessionStorage.getItem(WELCOME_FLAG) !== "1") return;
    sessionStorage.removeItem(WELCOME_FLAG);
    toast.success(t(GREETING_I18N[greetingKey(new Date())], { name }));
    // 挂载时消费一次标记；name/t 为渲染期已知量，无需重跑。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return null;
}
