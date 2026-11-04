import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";

import { Alert } from "@/components/ui/shadcn/alert";
import { Badge } from "@/components/ui/shadcn/badge";
import { requireUser } from "@/features/auth/session";
import { ChangePasswordForm } from "@/features/users/components/ChangePasswordForm";
import { LanguageSetting } from "@/features/users/components/LanguageSetting";
import { ReminderToggleList } from "@/features/users/components/ReminderToggleList";
import { getReminderPrefs, getUserLanguage } from "@/features/users/service";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("meta");

  return { title: t("settingsTitle") };
}

/** 卡片外壳：与团队设置页保持一致的描边、圆角与阴影。 */
const CARD_CLASS =
  "rounded-xl border border-[var(--border-default)] bg-white p-5 shadow-[0_1px_3px_rgba(14,19,24,0.04)]";

/** 卡片头部：左侧标题、右侧说明（对照原型 `.card-header`）。 */
function SettingsCardHeader({
  title,
  caption,
}: {
  title: string;
  caption: string;
}) {
  return (
    <div className="mb-4 flex items-center gap-3">
      <h2 className="flex-1 text-[16px] font-semibold text-[var(--ink-900)]">
        {title}
      </h2>
      <span className="text-right text-[12px] text-[color:var(--color-text-muted)]">{caption}</span>
    </div>
  );
}

/**
 * 个人空间设置页（RSC）。
 *
 * 文案与版式对照 `docs/prototypes/space-settings-personal.html`：账户安全
 * （改密码）、任务提醒（临期 / 逾期开关，作用于 due-scan）、项目排序
 * （服务端按最近活动排序的静态说明）。交互下沉到 client 包装件。
 */
export default async function PersonalSettingsPage() {
  const user = await requireUser();
  const prefs = await getReminderPrefs(user.id);
  const userLanguage = await getUserLanguage(user.id);
  const t = await getTranslations("settings");

  return (
    <div className="mx-auto w-full min-w-0 max-w-[760px]">
      <header className="mb-6">
        <h1 className="text-[30px] font-bold leading-[1.15] tracking-[-0.01em] text-[var(--ink-900)]">
          {t("title")}
        </h1>
        <p className="mt-1.5 text-[13.5px] text-[var(--ink-500)]">
          {t("subtitle")}
        </p>
      </header>

      <div className="flex flex-col gap-4">
        <section className={CARD_CLASS}>
          <SettingsCardHeader
            title={t("accountSecurity")}
            caption={t("accountSecurityCaption")}
          />

          <ChangePasswordForm />
        </section>

        <section className={CARD_CLASS}>
          <SettingsCardHeader
            title={t("reminders")}
            caption={t("remindersCaption")}
          />
          <p className="-mt-2 mb-1 text-[12px] text-[color:var(--color-text-muted)]">
            {t("remindersHint")}
          </p>

          <ReminderToggleList prefs={prefs} />

          <LanguageSetting language={userLanguage ?? "zh"} />

          <Alert variant="info" className="mt-4">
            {t("remindersDisabledAlert")}
          </Alert>
        </section>

        <section className={CARD_CLASS}>
          <SettingsCardHeader title={t("projectOrdering")} caption={t("projectOrderingCaption")} />
          <p className="-mt-2 mb-1 text-[12px] text-[color:var(--color-text-muted)]">
            {t("projectOrderingHint")}
          </p>

          <div className="flex items-center gap-4 py-[15px]">
            <div className="min-w-0 flex-1 leading-[1.45]">
              <div className="text-[13.5px] font-semibold text-[var(--ink-900)]">
                {t("byRecentActivity")}
              </div>
              <div className="mt-0.5 text-[12px] text-[color:var(--color-text-muted)]">
                {t("byRecentActivityDesc")}
              </div>
            </div>
            <Badge
              variant="outline"
              className="flex-none rounded-[var(--radius-pill)] border-transparent bg-[var(--info-bg)] px-2 py-0 text-[12px] font-medium leading-5 text-[var(--info-500)]"
            >
              {t("currentRule")}
            </Badge>
          </div>

          <Alert variant="info" className="mt-4">
            {t("orderingScopeAlert")}
          </Alert>
        </section>
      </div>
    </div>
  );
}
