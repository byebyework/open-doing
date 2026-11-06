import { addDays, displayName } from "@open-doing/types";
import { getTranslations } from "next-intl/server";
import Link from "next/link";
import type { ReactNode } from "react";

import { HintBadge } from "@/components/ui/HintBadge";
import { StatCard } from "@/components/ui/StatCard";
import {
  HEALTH_COLOR_RULES,
  HEALTH_LABEL_KEYS,
  resolveProjectHealthLevel,
} from "@/features/dashboard/team-overview/constants";
import { moduleHref, type SpaceRef } from "@/lib/routes";
import { getWeekStart } from "@/lib/today";

import {
  futureDueBuckets,
  trendBuckets,
  type AnalysisRange,
  type TrendBucket,
} from "../buckets";
import type { PersonalSpaceAnalysis, TeamSpaceAnalysis } from "../service";
import { AnalysisRangeSelector } from "./AnalysisRangeSelector";
import { HBarList, TrendChart, WeekMiniBars } from "./charts";

/** 分析页入参：`variant` 决定消费哪一份 DTO（另一份传 null）。 */
export interface SpaceAnalysisProps {
  variant: "personal" | "team";
  range: AnalysisRange;
  /** YYYY-MM-DD（Asia/Shanghai），服务端注入 */
  today: string;
  /** 模块根路径（`moduleHref(spaceRef, "analysis")`） */
  basePath: string;
  /** 空间引用（`personal` 或团队 slug），用于 Kanban 等站内跳转。 */
  spaceRef: SpaceRef;
  personal: PersonalSpaceAnalysis | null;
  team: TeamSpaceAnalysis | null;
}

/** 讨论 / 统计卡的统一外观（与 Dashboard 卡片一致）。 */
const CARD_CLASS =
  "min-w-0 rounded-xl border border-[var(--border-default)] bg-white p-4 shadow-[0_1px_3px_rgba(14,19,24,0.04)] min-[861px]:p-5";

/** 原型 `.callout.info` 的配色（设计令牌 info 系列）。 */
const INFO_CALLOUT_STYLE = {
  background: "rgba(13, 153, 255, 0.1)",
  color: "#0b6fb8",
} as const;

/** 页头：标题 + 口径说明 + 右侧范围切换。 */
async function PageHeader({
  variant,
  range,
  basePath,
}: {
  variant: SpaceAnalysisProps["variant"];
  range: AnalysisRange;
  basePath: string;
}) {
  const t = await getTranslations("analysis");
  const tNav = await getTranslations("nav");

  return (
    <header className="flex flex-col gap-3 min-[861px]:flex-row min-[861px]:items-start min-[861px]:justify-between min-[861px]:gap-4">
      <div className="min-w-0">
        <h1 className="text-[30px] font-bold leading-[1.15] tracking-[-0.01em] text-[var(--ink-900)]">
          {tNav("analysis")}
        </h1>
        <p className="mt-1.5 text-[14px] text-[var(--ink-500)]">
          {variant === "personal" ? t("personalSubtitle") : t("teamSubtitle")}
        </p>
      </div>
      <div className="flex flex-none items-center gap-2">
        <AnalysisRangeSelector basePath={basePath} range={range} />
      </div>
    </header>
  );
}

/** 原型 `.callout.info`（ℹ 图标 + 说明文案）。 */
function InfoCallout({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`flex gap-2.5 rounded-lg px-3.5 py-3 text-[13px] leading-[1.55] ${className}`}
      style={INFO_CALLOUT_STYLE}
    >
      <span aria-hidden="true" className="flex-none">
        ℹ
      </span>
      <span>{children}</span>
    </div>
  );
}

/** 卡头：左标题 + 右说明（可放图例）。 */
function CardHeader({
  title,
  caption,
  extra,
}: {
  title: string;
  caption?: ReactNode;
  extra?: ReactNode;
}) {
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-2">
      <h2 className="flex-1 text-[15px] font-bold text-[var(--ink-900)]">{title}</h2>
      {extra}
      {caption ? (
        <span className="ml-auto text-[12px] text-[var(--ink-500)]">{caption}</span>
      ) : null}
    </div>
  );
}

/**
 * 从实际分桶推导聚合粒度：存在跨天桶即为按周，否则按日。
 *
 * 不按 `range === 90` 重新编码规则——7/30 天与未来 14 天都是逐日桶，
 * 90 天由 `trendBuckets` 切成自然周桶。
 */
function bucketGrain(buckets: TrendBucket[]): "day" | "week" {
  return buckets.some((bucket) => bucket.start !== bucket.end) ? "week" : "day";
}

function sum(values: number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

/** 积压变化：正数带 `+`，负数用原型同款减号 `−`（U+2212）。 */
function signedDiff(diff: number): string {
  if (diff === 0) return "0";
  return diff > 0 ? `+${diff}` : `−${Math.abs(diff)}`;
}

/** 图例色块（文字始终使用正文 / muted 令牌，不穿系列色）。 */
function LegendSwatch({ color }: { color: string }) {
  return (
    <span
      className="inline-block"
      style={{
        width: 10,
        height: 10,
        borderRadius: 3,
        background: color,
        marginRight: 5,
      }}
      aria-hidden="true"
    />
  );
}

/** 个人空间 Analysis 主体。 */
async function PersonalBody({
  analysis,
  range,
  today,
}: {
  analysis: PersonalSpaceAnalysis;
  range: AnalysisRange;
  today: string;
}) {
  const t = await getTranslations("analysis");
  const tDashboard = await getTranslations("dashboard");
  // 图表使用真实分桶（含 start/end），与 service 的趋势点一一对应。
  const buckets = trendBuckets(today, range);
  const dueBuckets = futureDueBuckets(today);
  const unit = bucketGrain(buckets);
  // 仅逐日桶的末桶代表「今天」；90 天周桶的末桶代表本周，不能标「今天」。
  const todayIndex = unit === "day" ? buckets.length - 1 : undefined;
  const { stats } = analysis;

  const completionValues = analysis.completionTrend.map((point) => point.count);
  const completionTotal = sum(completionValues);

  const createdValues = analysis.createdVsCompleted.map(
    (point) => point.created,
  );
  const completedValues = analysis.createdVsCompleted.map(
    (point) => point.completed,
  );
  const createdTotal = sum(createdValues);
  const completedTotal = sum(completedValues);

  const futureDueValues = analysis.futureDue.map((point) => point.count);
  const futureDueTotal = sum(futureDueValues);

  const projectMax = Math.max(
    0,
    ...analysis.projectComparison.map((row) => row.doneCount),
  );
  const projectRows = analysis.projectComparison.map((row) => {
    const name = row.projectName || t("noProject");
    return {
      key: row.projectId ?? `no-project-${row.spaceType}`,
      name,
      title: t("hbarTitle", {
        name,
        range,
        count: row.doneCount,
      }),
      tag: row.spaceType === "team" ? tDashboard("sourceTeam") : undefined,
      count: row.doneCount,
      max: projectMax,
    };
  });

  const monthStart = `${today.slice(5, 7)}-01`;
  const rateValue =
    stats.onTime.ratePercent === null ? "—" : `${stats.onTime.ratePercent}%`;
  const rateHint =
    stats.onTime.denominator === 0
      ? t("onTimeNone")
      : t("onTimeSome", {
          total: stats.onTime.denominator,
          onTime: stats.onTime.onTime,
        });

  return (
    <>
      <div className="mt-6 grid grid-cols-2 gap-3 min-[861px]:grid-cols-4 min-[861px]:gap-4">
        <StatCard
          label={t("statInProgress")}
          value={stats.inProgress}
          hint={t("statInProgressHint")}
        />
        <StatCard
          label={t("statDoneThisMonth")}
          value={stats.doneThisMonth}
          hint={t("sinceDate", { date: monthStart })}
          color="#00b894"
        />
        <StatCard
          label={t("statOverdueNow")}
          value={stats.overdue}
          hint={
            stats.overdue > 0
              ? t("overdueHintAction")
              : tDashboard("overdueHintNone")
          }
          color="#ff5757"
        />
        <StatCard
          label={t("onTimeRate")}
          value={rateValue}
          hint={rateHint}
          color="#7d2ae8"
        />
      </div>

      <section className={`${CARD_CLASS} mt-5`}>
        <CardHeader
          title={t("trendTitle")}
          caption={
            <HintBadge
              ariaLabel={t("captionDoneHintAria")}
              summary={t("captionDone", {
                range,
                grain: unit === "day" ? t("grainDay") : t("grainWeek"),
                count: completionTotal,
              })}
              title={t("captionDoneHintTitle")}
              items={[
                t("captionDoneHintItemDate"),
                t("captionDoneHintItemRange"),
                t("captionDoneHintItemWeek"),
              ]}
            />
          }
        />
        <div className="mt-3">
          <TrendChart
            buckets={buckets}
            series={[{ tone: "primary", values: completionValues }]}
            todayIndex={todayIndex}
          />
        </div>
      </section>

      <div className="mt-4 grid grid-cols-1 items-start gap-4 min-[861px]:grid-cols-2">
        <section className={CARD_CLASS}>
          <CardHeader
            title={t("flowTitle")}
            extra={
              <span className="inline-flex items-center gap-3.5 text-[12.5px] text-[var(--ink-500)]">
                <span className="inline-flex items-center">
                  <LegendSwatch color="#0e9ba3" />
                  {t("legendCreated")}
                </span>
                <span className="inline-flex items-center">
                  <LegendSwatch color="#7d2ae8" />
                  {t("legendCompleted")}
                </span>
              </span>
            }
          />
          <div className="mt-1">
            <HintBadge
              ariaLabel={t("captionFlowHintAria")}
              summary={t("captionFlow", {
                range,
                grain: unit === "day" ? t("grainDay") : t("grainWeek"),
                created: createdTotal,
                completed: completedTotal,
                backlog: signedDiff(createdTotal - completedTotal),
              })}
              title={t("captionFlowHintTitle")}
              items={[t("captionFlowHintItem")]}
            />
          </div>
          <div className="mt-3">
            <TrendChart
              buckets={buckets}
              series={[
                { tone: "teal", values: createdValues },
                { tone: "primary", values: completedValues },
              ]}
              todayIndex={todayIndex}
            />
          </div>
        </section>

        <section className={CARD_CLASS}>
          <CardHeader
            title={t("futureTitle")}
            caption={
              <HintBadge
                ariaLabel={t("captionFutureHintAria")}
                summary={t("captionFuture", { count: futureDueTotal })}
                title={t("captionFutureHintTitle")}
                items={[
                  t("captionFutureHintItem"),
                  t("captionFutureHintItemRange"),
                ]}
              />
            }
          />
          <div className="mt-3">
            <TrendChart
              buckets={dueBuckets}
              series={[{ tone: "primary", values: futureDueValues }]}
              formatValue={(value) => t("valueDue", { value })}
              emptyLabel={t("none")}
              todayIndex={0}
            />
          </div>
        </section>
      </div>

      <section className={`${CARD_CLASS} mt-4`}>
        <CardHeader
          title={t("projectCompareTitle")}
          caption={t("projectCompareCaption", { range })}
        />
        <div className="mt-3">
          {projectRows.length === 0 ? (
            <p className="py-3 text-[13px] text-[var(--ink-500)]">
              {t("projectCompareEmpty")}
            </p>
          ) : (
            <HBarList rows={projectRows} />
          )}
        </div>
      </section>

      <div className="mt-4 flex justify-end">
        <HintBadge
          ariaLabel={t("footerHintAria")}
          summary={t("personalFooterHintSummary")}
          title={t("personalFooterHintTitle")}
          items={[
            t("onTimeHintItem"),
            t("captionDoneHintItemDate"),
            t("captionDoneHintItemRange"),
            t("captionDoneHintItemWeek"),
          ]}
        />
      </div>
    </>
  );
}

/** 团队空间 Analysis 主体。 */
async function TeamBody({
  analysis,
  range,
  today,
  spaceRef,
}: {
  analysis: TeamSpaceAnalysis;
  range: AnalysisRange;
  today: string;
  spaceRef: SpaceRef;
}) {
  const t = await getTranslations("analysis");
  const tDashboard = await getTranslations("dashboard");
  const tTasks = await getTranslations("tasks");
  const buckets = trendBuckets(today, range);
  const unit = bucketGrain(buckets);
  // 仅逐日桶的末桶代表「今天」；90 天周桶的末桶代表本周，不能标「今天」。
  const todayIndex = unit === "day" ? buckets.length - 1 : undefined;
  const { stats } = analysis;
  const weekStart = getWeekStart(today);
  const kanbanHref = moduleHref(spaceRef, "kanban");

  const throughputValues = analysis.throughput.map((point) => point.count);
  const throughputTotal = sum(throughputValues);

  const maxLoad = Math.max(
    1,
    ...analysis.members.map((member) => member.inProgress),
  );
  const memberRows = analysis.members.map((member) => ({
    key: member.userId,
    name: displayName(member),
    title: t("memberRowTitle", {
      name: displayName(member),
      count: member.inProgress,
    }),
    sub:
      member.overdue > 0
        ? tDashboard("loadOverdue", { count: member.overdue })
        : member.dueSoon > 0
          ? tDashboard("loadDueSoon", { count: member.dueSoon })
          : t("noOverdue"),
    count: member.inProgress,
    max: maxLoad,
  }));

  const projectNames = analysis.projectHealth
    .map((project) => project.projectName)
    .join(" · ");

  return (
    <>
      <div className="mt-6 grid grid-cols-2 gap-3 min-[861px]:grid-cols-4 min-[861px]:gap-4">
        <StatCard
          label={tDashboard("statProjects")}
          value={stats.projectCount}
          hint={projectNames || tDashboard("statProjectsHint")}
        />
        <StatCard
          label={tDashboard("statOverallProgress")}
          value={`${stats.avgProgressPercent}%`}
          hint={tDashboard("statOverallProgressHint")}
          color="#7d2ae8"
        />
        <StatCard
          label={t("statOverdueNow")}
          value={stats.overdue}
          hint={
            stats.overdue > 0
              ? tDashboard("statOverdueTasksHint")
              : tDashboard("overdueHintNone")
          }
          color="#ff5757"
        />
        <StatCard
          label={t("statDoneThisWeek")}
          value={stats.doneThisWeek}
          hint={tDashboard("statDoneThisWeekHint", {
            date: weekStart.slice(5),
          })}
          color="#00b894"
        />
      </div>

      <section className={`${CARD_CLASS} mt-5`}>
        <CardHeader
          title={t("throughputTitle")}
          caption={
            <HintBadge
              ariaLabel={t("captionDoneHintAria")}
              summary={t("captionDone", {
                range,
                grain: unit === "day" ? t("grainDay") : t("grainWeek"),
                count: throughputTotal,
              })}
              title={t("captionDoneHintTitle")}
              items={[
                t("captionDoneHintItemDate"),
                t("captionDoneHintItemRange"),
                t("captionDoneHintItemWeek"),
              ]}
            />
          }
        />
        <div className="mt-3">
          <TrendChart
            buckets={buckets}
            series={[{ tone: "primary", values: throughputValues }]}
            todayIndex={todayIndex}
          />
        </div>
      </section>

      <div className="mt-4 grid grid-cols-1 items-start gap-4 min-[861px]:grid-cols-2">
        <section className={CARD_CLASS}>
          <CardHeader
            title={t("memberLoadTitle")}
            caption={t("memberLoadCaption")}
          />
          <div className="mt-3">
            {memberRows.length === 0 ? (
              <p className="py-3 text-[13px] text-[var(--ink-500)]">
                {t("memberLoadEmpty")}
              </p>
            ) : (
              <HBarList rows={memberRows} />
            )}
          </div>
          <InfoCallout className="mt-3">
            {t("unassignedPrefix", { count: analysis.unassignedCount })}
            <Link
              href={kanbanHref}
              className="font-medium underline underline-offset-2"
            >
              Kanban
            </Link>
            {t("unassignedSuffix")}
          </InfoCallout>
        </section>

        <section className={CARD_CLASS}>
          <CardHeader
            title={tDashboard("healthTitle")}
            caption={tDashboard("healthHint")}
          />
          <div className="mt-3">
            {analysis.projectHealth.length === 0 ? (
              <p className="py-3 text-[13px] text-[var(--ink-500)]">
                {t("noProjects")}
              </p>
            ) : (
              analysis.projectHealth.map((project, index) => {
                const level = resolveProjectHealthLevel(
                  project.hasOverdue,
                  project.hasDueSoon,
                );
                const rule = HEALTH_COLOR_RULES[level];

                return (
                  <div
                    key={project.projectId}
                    className={`py-[14px] ${
                      index > 0 ? "border-t border-[var(--border-default)]" : ""
                    }`}
                  >
                    <div className="flex min-w-0 items-center gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-[14px] font-semibold text-[var(--ink-900)]">
                          {project.projectName}
                        </div>
                        <div className="mt-0.5 text-[12px] text-[var(--ink-500)]">
                          {t("projectLine", {
                            count: project.taskCount,
                            done: project.doneTotal,
                          })}
                        </div>
                      </div>
                      <span
                        className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full px-2.5 py-0.5 text-[12px] font-semibold"
                        style={{
                          background: rule.background,
                          color: rule.color,
                        }}
                      >
                        <span
                          className="inline-block h-1.5 w-1.5 rounded-full"
                          style={{ background: "currentColor" }}
                          aria-hidden="true"
                        />
                        {tDashboard(HEALTH_LABEL_KEYS[level])}
                      </span>
                      <span
                        className="w-10 shrink-0 text-right text-[13px] font-bold"
                        style={{
                          color: rule.color,
                          fontVariantNumeric: "tabular-nums",
                        }}
                      >
                        {project.progressPercent}%
                      </span>
                    </div>

                    <div
                      className="mt-2.5 h-1.5 overflow-hidden rounded-full"
                      style={{ background: "#e8eaed" }}
                    >
                      <span
                        className="block h-full rounded-full"
                        style={{
                          width: `${project.progressPercent}%`,
                          background: rule.color,
                        }}
                      />
                    </div>

                    <div className="mt-2 flex items-center gap-2.5">
                      <span className="text-[12px] text-[var(--ink-500)]">
                        {t("weeklyDoneLabel")}
                      </span>
                      <WeekMiniBars
                        values={project.weeklyDone}
                        title={t("weeklyDoneTitle", {
                          list: project.weeklyDone.join(" / "),
                        })}
                      />
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </section>
      </div>

      <section className={`${CARD_CLASS} mt-4`}>
        <CardHeader
          title={t("zombieTitle")}
          caption={t("zombieCaption")}
        />

        {analysis.zombieTasks.length === 0 ? (
          <p className="mt-3 text-[13px] text-[var(--ink-500)]">
            {t("zombieEmpty")}
          </p>
        ) : (
          <div className="mt-2">
            {analysis.zombieTasks.map((task) => (
              <div
                key={task.id}
                className="flex min-w-0 items-start gap-2.5 border-t border-[var(--border-default)] py-[11px] first:border-t-0"
              >
                <span
                  className="grid h-7 w-7 flex-none place-items-center rounded-lg text-[14px]"
                  style={{ background: "rgba(255, 176, 32, 0.12)" }}
                  aria-hidden="true"
                >
                  🕸
                </span>
                <div className="min-w-0 flex-1">
                  <div className="text-[13.5px] font-semibold leading-[1.35] text-[var(--ink-900)]">
                    {task.title}
                  </div>
                  <div className="mt-1 text-[12px] text-[var(--ink-500)]">
                    {task.projectName} ·{" "}
                    {task.assigneeName ?? tTasks("unassigned")} ·{" "}
                    {t("lastUpdatedLine", {
                      date: addDays(today, -task.stalledDays).slice(5),
                      days: task.stalledDays,
                    })}
                  </div>
                </div>
                <span
                  className="ml-auto inline-flex shrink-0 items-center whitespace-nowrap rounded-full px-2.5 py-0.5 text-[12px] font-semibold"
                  style={{
                    background: "rgba(255, 176, 32, 0.12)",
                    color: "#a66b00",
                  }}
                >
                  {t("stalledBadge", { days: task.stalledDays })}
                </span>
              </div>
            ))}
          </div>
        )}

        <div className="mt-3 border-t border-[var(--border-default)] pt-2.5">
          <Link
            href={kanbanHref}
            className="text-[13px] font-medium text-[#7d2ae8] no-underline hover:underline"
          >
            {t("zombieFooter")}
          </Link>
        </div>
      </section>

      <div className="mt-4 flex justify-end">
        <HintBadge
          ariaLabel={t("footerHintAria")}
          summary={t("teamFooterHintSummary")}
          title={t("teamFooterHintTitle")}
          items={[
            t("captionDoneHintItemDate"),
            t("memberLoadHintItem"),
            t("zombieHintItem"),
            t("captionDoneHintItemRange"),
            t("captionDoneHintItemWeek"),
          ]}
        />
      </div>
    </>
  );
}

/**
 * 空间 Analysis 展示（个人 / 团队共用）。
 *
 * 纯服务端组件：只消费已序列化的 DTO，按 `variant` 分支渲染；
 * 唯一交互（时间范围切换）下沉到 `AnalysisRangeSelector`。
 */
export async function SpaceAnalysis({
  variant,
  range,
  today,
  basePath,
  spaceRef,
  personal,
  team,
}: SpaceAnalysisProps) {
  let body: ReactNode = null;

  if (variant === "personal" && personal) {
    body = <PersonalBody analysis={personal} range={range} today={today} />;
  } else if (variant === "team" && team) {
    body = (
      <TeamBody
        analysis={team}
        range={range}
        today={today}
        spaceRef={spaceRef}
      />
    );
  }

  return (
    <div className="mx-auto w-full min-w-0 max-w-[1320px]">
      <PageHeader variant={variant} range={range} basePath={basePath} />
      {body}
    </div>
  );
}
