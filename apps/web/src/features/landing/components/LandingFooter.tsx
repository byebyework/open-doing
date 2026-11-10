import { getTranslations } from "next-intl/server";

import { BrandMark } from "@/components/ui/BrandMark";

/**
 * 落地页页脚：顶部发丝线 + 品牌标志与版权行。
 *
 * 版权文案走消息包（landing.footer.copyright），中英文按键结构一致。
 */
export async function LandingFooter() {
  const t = await getTranslations("landing");

  return (
    <footer className="border-t border-[var(--border-default)] bg-[var(--surface-white)]">
      <div className="mx-auto flex max-w-[1120px] items-center gap-2.5 px-4 py-8 sm:px-6">
        <BrandMark className="h-5 w-5 shrink-0" />
        <span className="text-[12px] text-[var(--ink-400)]">
          {t("footer.copyright")}
        </span>
      </div>
    </footer>
  );
}
