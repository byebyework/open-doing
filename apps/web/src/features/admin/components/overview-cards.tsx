import Link from "next/link";
import { getTranslations } from "next-intl/server";
import type { ReactNode } from "react";

import { type StatCardIconTone, StatCard } from "@/components/ui/StatCard";
import { CARD_SHELL } from "@/components/ui/card";
import { Alert } from "@/components/ui/shadcn/alert";
import { Badge } from "@/components/ui/shadcn/badge";

import { codeStatus, type CodeStatus } from "../code-status";
import type { AdminCodeRow, AdminOverviewStats } from "../service";

/** 14px 线性图标（与原型统计卡的 icon-chip 同款）。 */
const ICON_CLASS = "h-3.5 w-3.5";

function UsersIcon() {
  return (
    <svg
      className={ICON_CLASS}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  );
}

function FolderIcon() {
  return (
    <svg
      className={ICON_CLASS}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
    </svg>
  );
}

function TaskIcon() {
  return (
    <svg
      className={ICON_CLASS}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M9 11l3 3L22 4" />
      <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
    </svg>
  );
}

function WarningIcon() {
  return (
    <svg
      className="h-4 w-4"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
      <path d="M12 9v4" />
      <path d="M12 17h.01" />
    </svg>
  );
}

/** 状态 → 文案 key 与徽标色组（原型 badge-done / badge-overdue / badge-due-soon）。 */
const STATUS_LABEL_KEY = {
  normal: "regCodeStatusNormal",
  exhausted: "regCodeStatusExhausted",
  low: "regCodeStatusLow",
} as const;

const STATUS_BADGE_CLASS: Record<CodeStatus, string> = {
  normal: "bg-[var(--status-done-bg)] text-[var(--status-done)]",
  exhausted: "bg-[var(--status-overdue-bg)] text-[var(--status-overdue)]",
  low: "bg-[var(--status-due-soon-bg)] text-[var(--status-due-soon)]",
};

/** 状态 → 进度条填充色（原型 .progress.is-error / .is-warning）。 */
const STATUS_PROGRESS_COLOR: Record<CodeStatus, string> = {
  normal: "var(--primary)",
  exhausted: "var(--error)",
  low: "var(--warning)",
};

/** 卡片内边距与卡片标题样式（原型 .card / .card-header / .card-title）。 */
const CARD_CLASS = `${CARD_SHELL} p-5`;
const CARD_TITLE_CLASS =
  "text-[16px] font-bold leading-[1.2] text-[var(--ink-900)]";

/** 管理概览的四张统计卡（图标槽由 StatCard 的 icon / iconTone 提供）。 */
const STAT_CARDS: {
  labelKey: "statUsers" | "statTeams" | "statProjects" | "statTasks";
  hintKey:
    | "statUsersDelta"
    | "statTeamsDelta"
    | "statProjectsDelta"
    | "statTasksDelta";
  icon: () => ReactNode;
  iconTone: StatCardIconTone;
}[] = [
  { labelKey: "statUsers", hintKey: "statUsersDelta", icon: UsersIcon, iconTone: "purple" },
  { labelKey: "statTeams", hintKey: "statTeamsDelta", icon: UsersIcon, iconTone: "lavender" },
  { labelKey: "statProjects", hintKey: "statProjectsDelta", icon: FolderIcon, iconTone: "mint" },
  { labelKey: "statTasks", hintKey: "statTasksDelta", icon: TaskIcon, iconTone: "info" },
];

/** 汇总卡的一行（原型 .sum-row：左键右值，行间分隔线）。 */
function SumRow({ label, value, color }: { label: string; value: number; color?: string }) {
  return (
    <div className="flex items-baseline gap-3 border-t border-[var(--border-default)] py-3 first:border-t-0">
      <span className="flex-1 text-[13px] text-[var(--muted-foreground)]">{label}</span>
      <span
        className="text-[20px] font-extrabold tracking-[-0.02em] [font-variant-numeric:tabular-nums]"
        style={color ? { color } : undefined}
      >
        {value}
      </span>
    </div>
  );
}

/**
 * 管理概览的展示区（RSC 纯展示，无任何交互组件）。
 *
 * 数据全部由 `/admin` 页面并行取好后传入：四张统计卡直接消费
 * `getAdminOverview()`；「注册码余量」逐码展示用量与状态，
 * 「注册码汇总」展示名额总量。仅 `管理注册码` 是普通导航链接。
 */
export async function OverviewCards({
  overview,
  codes,
}: {
  overview: AdminOverviewStats;
  codes: AdminCodeRow[];
}) {
  const t = await getTranslations("admin");
  const lowCount = codes.filter(
    (code) => code.maxUses - code.usedCount <= 2,
  ).length;

  const statValue = {
    statUsers: overview.userCount,
    statTeams: overview.teamCount,
    statProjects: overview.projectCount,
    statTasks: overview.taskCount,
  } as const;

  const hintFor = (key: (typeof STAT_CARDS)[number]["hintKey"]) => {
    switch (key) {
      case "statUsersDelta":
        return t(key, {
          admin: overview.adminCount,
          disabled: overview.disabledCount,
        });
      case "statTeamsDelta":
        return t(key, { memberships: overview.membershipCount });
      case "statProjectsDelta":
        return t(key, {
          personal: overview.personalProjectCount,
          team: overview.teamProjectCount,
        });
      case "statTasksDelta":
        return t(key, { overdue: overview.overdueTaskCount });
    }
  };

  return (
    <>
      <div className="mt-6 grid grid-cols-2 gap-3 min-[861px]:grid-cols-4 min-[861px]:gap-4">
        {STAT_CARDS.map(({ labelKey, hintKey, icon: Icon, iconTone }) => (
          <StatCard
            key={labelKey}
            icon={<Icon />}
            iconTone={iconTone}
            label={t(labelKey)}
            value={statValue[labelKey]}
            hint={hintFor(hintKey)}
          />
        ))}
      </div>

      <div className="mt-4 grid gap-4 min-[1101px]:grid-cols-[1.6fr_1fr] min-[1101px]:items-start">
        {/* 注册码余量：逐码进度 + 状态徽标 */}
        <section className={CARD_CLASS}>
          <div className="mb-4 flex items-center gap-3">
            <h2 className={`flex-1 ${CARD_TITLE_CLASS}`}>{t("regCodesCardTitle")}</h2>
            <Link
              href="/admin/registration-codes"
              className="rounded-[var(--radius-8)] px-2 py-1 text-[13px] font-semibold text-[var(--purple-600)] no-underline transition-colors hover:bg-[var(--primary-bg)]"
            >
              {t("regCodesManage")}
            </Link>
          </div>

          {lowCount > 0 ? (
            <Alert variant="warning" className="mb-4">
              <WarningIcon />
              <span>{t("regCodesLowWarning", { count: lowCount })}</span>
            </Alert>
          ) : null}

          <div className="divide-y divide-[var(--border-default)]">
            {codes.map((code) => {
              const status = codeStatus(code.maxUses, code.usedCount);
              const percent =
                code.maxUses > 0
                  ? Math.min(
                      100,
                      Math.max(0, (code.usedCount / code.maxUses) * 100),
                    )
                  : 100;

              return (
                <div key={code.code} className="py-3.5">
                  <div className="flex items-center gap-3">
                    <code className="font-mono text-[13px] font-semibold tracking-[0.02em] text-[var(--ink-900)]">
                      {code.code}
                    </code>
                    <Badge
                      variant="neutral"
                      className={`ml-auto rounded-[var(--radius-8)] px-2 py-0 text-[12px] font-semibold ${STATUS_BADGE_CLASS[status]}`}
                    >
                      {t(STATUS_LABEL_KEY[status])}
                    </Badge>
                  </div>
                  <div className="mt-2 flex min-w-[180px] items-center gap-3">
                    <div
                      role="progressbar"
                      aria-label={code.code}
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-valuenow={Math.round(percent)}
                      className="h-[6px] flex-1 overflow-hidden rounded-full bg-[var(--surface-inset)]"
                    >
                      <div
                        className="h-full rounded-full"
                        style={{
                          width: `${percent}%`,
                          background: STATUS_PROGRESS_COLOR[status],
                        }}
                      />
                    </div>
                    <span className="whitespace-nowrap text-[12px] text-[var(--muted-foreground)] [font-variant-numeric:tabular-nums]">
                      {code.usedCount} / {code.maxUses}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        {/* 注册码汇总：总数 / 总名额 / 已用 / 剩余 */}
        <section className={CARD_CLASS}>
          <h2 className={CARD_TITLE_CLASS}>{t("regCodesSummaryTitle")}</h2>
          <div className="mt-4">
            <SumRow label={t("regCodesSummaryCount")} value={overview.regCodeCount} />
            <SumRow label={t("regCodesSummaryQuota")} value={overview.regCodeTotalQuota} />
            <SumRow label={t("regCodesSummaryUsed")} value={overview.regCodeUsed} />
            <SumRow
              label={t("regCodesSummaryRemaining")}
              value={overview.regCodeRemaining}
              color="var(--success)"
            />
          </div>
          <div className="mt-4 border-t border-[var(--border-default)] pt-4 text-[12px] text-[var(--ink-400)]">
            {t("regCodesSummaryHint")}
          </div>
        </section>
      </div>
    </>
  );
}
