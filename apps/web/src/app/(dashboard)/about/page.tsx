import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";

import { PageHeader } from "@/components/ui/PageHeader";
import { CopyValueButton } from "@/components/ui/CopyValueButton";
import { CARD_SHELL } from "@/components/ui/card";
import { Badge } from "@/components/ui/shadcn/badge";
import {
  APP_VERSION,
  resolveBuildInfo,
  splitUptime,
} from "@/lib/system-info";

/** 「关于系统」页元数据（route 类型由 next typegen 生成）。 */
export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("about");
  return { title: t("title") };
}

/** 数据行：左标签右值（原型 .meta-row 规格）。 */
function InfoRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3 border-b border-[var(--border)] py-3 text-[13px] last:border-b-0">
      <span className="w-20 shrink-0 text-[var(--muted-foreground)]">{label}</span>
      <span className="flex min-w-0 flex-1 items-center gap-2 font-medium text-[var(--ink-900)]">
        {children}
      </span>
    </div>
  );
}

/** 卡片脚注（原型 .card-footer 说明行）。 */
function Footnote({ children }: { children: React.ReactNode }) {
  return (
    <div className="mt-4 border-t border-[var(--border)] pt-4 text-[12px] text-[var(--muted-foreground)]">
      {children}
    </div>
  );
}

/**
 * 关于系统：当前部署的版本与运行环境信息，纯展示（无操作、无交互表单）。
 *
 * 数据全部现查：版本来自 package.json，构建元数据来自镜像构建时注入的
 * GIT_COMMIT_SHA / BUILD_TIME（dev 缺失显示「未知（开发模式）」），运行
 * 时长为当前进程 uptime。样式对齐 docs/prototypes/about.html：
 * 双卡等高（items-stretch + flex 列 + 脚注沉底），基线 `.card + .card`
 * 的纵向 margin 在 grid 里归零（gap-4 已承担间距）。
 */
export default async function AboutPage() {
  const t = await getTranslations("about");

  const build = resolveBuildInfo(process.env);
  const uptime = splitUptime(process.uptime());
  const uptimeText =
    uptime.days !== null
      ? t("uptimeDaysHours", { days: uptime.days, hours: uptime.hours! })
      : uptime.hours !== null
        ? t("uptimeHoursMinutes", { hours: uptime.hours, minutes: uptime.minutes! })
        : uptime.minutes !== null
          ? t("uptimeMinutes", { minutes: uptime.minutes })
          : t("uptimeMoments");

  return (
    <div className="mx-auto w-full max-w-[var(--content-max-width)]">
      <PageHeader title={t("title")} subtitle={t("subtitle")} />

      <div className="grid grid-cols-1 items-stretch gap-4 min-[1101px]:grid-cols-2">
        {/* 版本与构建 */}
        <section className={`${CARD_SHELL} flex flex-col p-5`}>
          <h2 className="mb-4 text-[16px] font-bold text-[var(--ink-900)]">
            {t("buildCardTitle")}
          </h2>
          <div className="flex flex-1 flex-col justify-start">
            <InfoRow label={t("fieldVersion")}>
              <code className="font-mono text-[13px] font-semibold">v{APP_VERSION}</code>
              <CopyValueButton value={`v${APP_VERSION}`} label={t("fieldVersion")} />
            </InfoRow>
            <InfoRow label={t("fieldCommit")}>
              {build.commit ? (
                <>
                  <code className="font-mono text-[13px] font-semibold">
                    {build.commit.slice(0, 8)}
                  </code>
                  <CopyValueButton
                    value={build.commit}
                    label={t("fieldCommit")}
                  />
                </>
              ) : (
                t("devUnknown")
              )}
            </InfoRow>
            <InfoRow label={t("fieldBuildTime")}>
              {build.buildTime ?? t("devUnknown")}
            </InfoRow>
          </div>
          <Footnote>{t("buildFootnote")}</Footnote>
        </section>

        {/* 运行环境 */}
        <section className={`${CARD_SHELL} flex flex-col p-5`}>
          <h2 className="mb-4 text-[16px] font-bold text-[var(--ink-900)]">
            {t("runtimeCardTitle")}
          </h2>
          <div className="flex flex-1 flex-col justify-start">
            <InfoRow label={t("fieldEnv")}>
              <Badge
                variant="outline"
                className="border-[var(--info-bg)] bg-[var(--info-bg)] text-[#0b6fb8]"
              >
                {process.env.NODE_ENV === "production"
                  ? t("envProduction")
                  : t("envDevelopment")}
              </Badge>
            </InfoRow>
            <InfoRow label={t("fieldNode")}>
              <code className="font-mono text-[13px] font-semibold">
                {process.version}
              </code>
            </InfoRow>
            <InfoRow label={t("fieldDatabase")}>PostgreSQL 16</InfoRow>
            <InfoRow label={t("fieldUptime")}>{uptimeText}</InfoRow>
          </div>
          <Footnote>{t("uptimeFootnote")}</Footnote>
        </section>
      </div>
    </div>
  );
}
