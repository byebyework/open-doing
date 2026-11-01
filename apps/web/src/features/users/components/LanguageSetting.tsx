"use client";

import { App, Select } from "antd";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { useTranslations } from "next-intl";

import type { AppLocale } from "@/i18n/config";

import { updateLanguageAction } from "../actions";

export interface LanguageSettingProps {
  /** 当前用户的界面语言（RSC 从会话用户读取传入）。 */
  language: AppLocale;
}

/** antd Select 可选项（语言名用各自母语展示，不随 locale 翻译）。 */
const LANGUAGE_OPTIONS = [
  { value: "zh", label: "简体中文" },
  { value: "en", label: "English" },
] as const satisfies readonly { value: AppLocale; label: string }[];

/**
 * 界面语言选择（个人设置页客户端交互层）。
 *
 * 切换调用 Server Action（DB + cookie 同步更新），成功后 `router.refresh()`
 * 让整棵 RSC 树以新语言重渲染。语言名列表用母语展示是通用惯例
 * （用户可能在看不懂当前界面语言时需要找到这个入口）。
 */
export function LanguageSetting({ language }: LanguageSettingProps) {
  const { message } = App.useApp();
  const t = useTranslations("settings");
  const router = useRouter();
  const [current, setCurrent] = useState<AppLocale>(language);
  const [synced, setSynced] = useState(language);
  // 待弹 toast 的目标语言（ref：等 refresh 送达新语言后由 effect 消费）。
  const pendingToast = useRef<AppLocale | null>(null);
  const [pending, startTransition] = useTransition();

  // 渲染期同步 props → state：action 成功后 refresh 带来新的服务端语言。
  if (language !== synced) {
    setSynced(language);
    setCurrent(language);
  }

  // 成功 toast 延迟到 refresh 把新 locale 的消息包送达后再弹：
  // 切换瞬间 `t` 仍绑定旧语言消息（切英文却弹中文提示观感即 bug），
  // 这里等 `language` prop 变成目标语言后，t() 才以新语言解析文案。
  useEffect(() => {
    if (pendingToast.current !== null && pendingToast.current === language) {
      pendingToast.current = null;
      message.success(t("languageChanged"));
    }
  }, [language, t]);

  function handleChange(next: AppLocale) {
    const previous = current;
    setCurrent(next);
    startTransition(async () => {
      try {
        const result = await updateLanguageAction({ language: next });
        if (!result.ok) {
          // 失败时界面没有切换语言，用当前（旧）语言的错误提示是正确的。
          message.error(t("saveFailed"));
          setCurrent(previous);
          return;
        }
        pendingToast.current = next;
        router.refresh();
      } catch {
        message.error(t("saveFailed"));
        setCurrent(previous);
      }
    });
  }

  return (
    <div className="flex items-center gap-4 py-[15px]">
      <div className="min-w-0 flex-1 leading-[1.45]">
        <div className="text-[13.5px] font-semibold text-[#0e1318]">
          {t("language")}
        </div>
        <div className="mt-0.5 text-[12px] text-[#9aa0a6]">
          {t("languageCaption")}
        </div>
      </div>
      <Select<AppLocale>
        data-testid="language-select"
        value={current}
        options={[...LANGUAGE_OPTIONS]}
        loading={pending}
        disabled={pending}
        onChange={handleChange}
        aria-label={t("language")}
        className="w-[140px]"
      />
    </div>
  );
}
