import { addDays } from "@open-doing/types";
import Link from "next/link";
import type { ReactNode } from "react";

import { StatCard } from "@/components/ui/StatCard";
import {
  HEALTH_COLOR_RULES,
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
  "min-w-0 rounded-xl border border-[#e1e3e6] bg-white p-4 shadow-[0_1px_3px_rgba(14,19,24,0.04)] min-[861px]:p-5";

/** 原型 `.callout.info` 的配色（设计令牌 info 系列）。 */
const INFO_CALLOUT_STYLE = {
  background: "rgba(13, 153, 255, 0.1)",
  color: "#0b6fb8",
} as const;

const PERSONAL_SUBTITLE =
  "完成节奏、积压涨消与截止分布——回顾你这段时间的推进；今天的待办看 Dashboard。";
const TEAM_SUBTITLE =
  "吞吐、成员负载与项目健康度——看清团队的推进节奏；今天的风险看 Dashboard。";

const PERSONAL_FOOTER_NOTE =
  "口径说明：完成日按任务最近一次状态更新时间近似（与 Calendar、通知同口径）；「按时率」只统计有截止日期的已完成任务，无截止日期不进分母；时间范围只影响趋势区块，顶部统计卡恒为当前快照。切换「近 90 天」时柱状图改为按周聚合。";
const TEAM_FOOTER_NOTE =
  "口径说明：完成日按任务最近一次状态更新时间近似（与 Calendar、通知同口径）；成员负载按「创建 ≤ 查询日 < 完成日」重建，可回看任意历史日；僵尸任务 = 进行中且超过 14 天未更新。时间范围只影响趋势区块，顶部统计卡恒为当前快照。切换「近 90 天」时柱状图改为按周聚合。";

/** 页头：标题 + 口径说明 + 右侧范围切换。 */
function PageHeader({
  variant,
  range,
  basePath,
}: {
  variant: SpaceAnalysisProps["variant"];
  range: AnalysisRange;
  basePath: string;
}) {
  return (
    <header className="flex flex-col gap-3 min-[861px]:flex-row min-[861px]:items-start min-[861px]:justify-between min-[861px]:gap-4">
      <div className="min-w-0">
        <h1 className="text-[30px] font-bold leading-[1.15] tracking-[-0.01em] text-[#0e1318]">
          Analysis
        </h1>
        <p className="mt-1.5 text-[14px] text-[#5f6368]">
          {variant === "personal" ? PERSONAL_SUBTITLE : TEAM_SUBTITLE}
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
      <h2 className="flex-1 text-[15px] font-bold text-[#0e1318]">{title}</h2>
      {extra}
      {caption ? (
        <span className="ml-auto text-[12px] text-[#5f6368]">{caption}</span>
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
function bucketGrain(buckets: TrendBucket[]): "日" | "周" {
  return buckets.some((bucket) => bucket.start !== bucket.end) ? "周" : "日";
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
function PersonalBody({
  analysis,
  range,
  today,
}: {
  analysis: PersonalSpaceAnalysis;
  range: AnalysisRange;
  today: string;
}) {
  // 图表使用真实分桶（含 start/end），与 service 的趋势点一一对应。
  const buckets = trendBuckets(today, range);
  const dueBuckets = futureDueBuckets(today);
  const unit = bucketGrain(buckets);
  // 仅逐日桶的末桶代表「今天」；90 天周桶的末桶代表本周，不能标「今天」。
  const todayIndex = unit === "日" ? buckets.length - 1 : undefined;
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
    const name = row.projectName || "无项目";
    return {
      key: row.projectId ?? `no-project-${row.projectName}`,
      name,
      title: `${name} · 近 ${range} 天完成 ${row.doneCount} 项`,
      tag: row.spaceType === "team" ? "团队" : undefined,
      count: row.doneCount,
      max: projectMax,
    };
  });

  const monthStart = `${today.slice(5, 7)}-01`;
  const rateValue =
    stats.onTime.ratePercent === null ? "—" : `${stats.onTime.ratePercent}%`;
  const rateHint =
    stats.onTime.denominator === 0
      ? "近 30 天 · 暂无有截止日期的已完成"
      : `近 30 天 · ${stats.onTime.denominator} 项有截止的已完成中 ${stats.onTime.onTime} 项按时`;

  return (
    <>
      <div className="mt-6 grid grid-cols-2 gap-3 min-[861px]:grid-cols-4 min-[861px]:gap-4">
        <StatCard
          label="进行中"
          value={stats.inProgress}
          hint="含个人与指派给你的团队任务"
        />
        <StatCard
          label="本月完成"
          value={stats.doneThisMonth}
          hint={`自 ${monthStart} 以来`}
          color="#00b894"
        />
        <StatCard
          label="当前逾期"
          value={stats.overdue}
          hint={stats.overdue > 0 ? "建议今天优先处理" : "暂无逾期"}
          color="#ff5757"
        />
        <StatCard
          label="按时率"
          value={rateValue}
          hint={rateHint}
          color="#7d2ae8"
        />
      </div>

      <section className={`${CARD_CLASS} mt-5`}>
        <CardHeader
          title="完成趋势"
          caption={`近 ${range} 天 · 按${unit} · 共完成 ${completionTotal} 项`}
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
            title="新增 vs 完成"
            extra={
              <span className="inline-flex items-center gap-3.5 text-[12.5px] text-[#5f6368]">
                <span className="inline-flex items-center">
                  <LegendSwatch color="#0e9ba3" />
                  新增
                </span>
                <span className="inline-flex items-center">
                  <LegendSwatch color="#7d2ae8" />
                  完成
                </span>
              </span>
            }
          />
          <div className="mt-1 text-[12px] text-[#5f6368]">
            近 {range} 天 · 按{unit} · 新增 {createdTotal} 项 / 完成{" "}
            {completedTotal} 项，积压{" "}
            {signedDiff(createdTotal - completedTotal)}
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
            title="未来截止分布"
            caption={`未来 14 天 · 按日 · 共 ${futureDueTotal} 项`}
          />
          <div className="mt-3">
            <TrendChart
              buckets={dueBuckets}
              series={[{ tone: "primary", values: futureDueValues }]}
              formatValue={(value) => `${value} 项到期`}
              emptyLabel="无"
              todayIndex={0}
            />
          </div>
          <InfoCallout className="mt-3">
            含个人与指派给你的团队任务；逾期任务不计入未来分布，看上方「当前逾期」。
          </InfoCallout>
        </section>
      </div>

      <section className={`${CARD_CLASS} mt-4`}>
        <CardHeader
          title="项目对比"
          caption={`近 ${range} 天完成任务数 · 含个人与团队项目`}
        />
        <div className="mt-3">
          {projectRows.length === 0 ? (
            <p className="py-3 text-[13px] text-[#5f6368]">
              暂无项目完成数据。
            </p>
          ) : (
            <HBarList rows={projectRows} />
          )}
        </div>
      </section>

      <InfoCallout className="mt-4">{PERSONAL_FOOTER_NOTE}</InfoCallout>
    </>
  );
}

/** 团队空间 Analysis 主体。 */
function TeamBody({
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
  const buckets = trendBuckets(today, range);
  const unit = bucketGrain(buckets);
  // 仅逐日桶的末桶代表「今天」；90 天周桶的末桶代表本周，不能标「今天」。
  const todayIndex = unit === "日" ? buckets.length - 1 : undefined;
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
    name: member.username,
    title: `${member.username} · 进行中 ${member.inProgress} 项`,
    sub:
      member.overdue > 0
        ? `已逾期 ${member.overdue} 项`
        : member.dueSoon > 0
          ? `临期 ${member.dueSoon} 项`
          : "无逾期",
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
          label="在册项目"
          value={stats.projectCount}
          hint={projectNames || "团队全部项目"}
        />
        <StatCard
          label="团队整体进度"
          value={`${stats.avgProgressPercent}%`}
          hint="按任务等权平均"
          color="#7d2ae8"
        />
        <StatCard
          label="当前逾期"
          value={stats.overdue}
          hint={stats.overdue > 0 ? "请优先处理" : "暂无逾期"}
          color="#ff5757"
        />
        <StatCard
          label="本周完成"
          value={stats.doneThisWeek}
          hint={`自本周一（${weekStart.slice(5)}）以来`}
          color="#00b894"
        />
      </div>

      <section className={`${CARD_CLASS} mt-5`}>
        <CardHeader
          title="吞吐"
          caption={`近 ${range} 天 · 按${unit} · 共完成 ${throughputTotal} 项`}
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
            title="成员负载分布"
            caption="当前进行中任务数 · 可回看任意历史日"
          />
          <div className="mt-3">
            {memberRows.length === 0 ? (
              <p className="py-3 text-[13px] text-[#5f6368]">
                暂无成员负载数据。
              </p>
            ) : (
              <HBarList rows={memberRows} />
            )}
          </div>
          {/* 「未指派任务 N 项」callout 已按定稿偏差省略：getTeamOverview 不提供该计数。 */}
        </section>

        <section className={CARD_CLASS}>
          <CardHeader
            title="项目健康度"
            caption="进度按任务完成度自动聚合"
          />
          <div className="mt-3">
            {analysis.projectHealth.length === 0 ? (
              <p className="py-3 text-[13px] text-[#5f6368]">暂无项目。</p>
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
                      index > 0 ? "border-t border-[#e1e3e6]" : ""
                    }`}
                  >
                    <div className="flex min-w-0 items-center gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-[14px] font-semibold text-[#0e1318]">
                          {project.projectName}
                        </div>
                        <div className="mt-0.5 text-[12px] text-[#5f6368]">
                          {project.taskCount} 个任务 · {project.doneTotal} 已完成
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
                        {rule.label}
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
                      <span className="text-[12px] text-[#5f6368]">
                        近 6 周完成
                      </span>
                      <WeekMiniBars
                        values={project.weeklyDone}
                        title={`近 6 周每周完成 ${project.weeklyDone.join(" / ")} 项`}
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
          title="僵尸任务"
          caption="进行中且超过 14 天未更新 · 按停留时长降序"
        />

        {analysis.zombieTasks.length === 0 ? (
          <p className="mt-3 text-[13px] text-[#5f6368]">暂无僵尸任务。</p>
        ) : (
          <div className="mt-2">
            {analysis.zombieTasks.map((task) => (
              <div
                key={task.id}
                className="flex min-w-0 items-start gap-2.5 border-t border-[#e1e3e6] py-[11px] first:border-t-0"
              >
                <span
                  className="grid h-7 w-7 flex-none place-items-center rounded-lg text-[14px]"
                  style={{ background: "rgba(255, 176, 32, 0.12)" }}
                  aria-hidden="true"
                >
                  🕸
                </span>
                <div className="min-w-0 flex-1">
                  <div className="text-[13.5px] font-semibold leading-[1.35] text-[#0e1318]">
                    {task.title}
                  </div>
                  <div className="mt-1 text-[12px] text-[#5f6368]">
                    {task.projectName} · {task.assigneeName ?? "未指派"} ·
                    最后更新 {addDays(today, -task.stalledDays).slice(5)}，已停留{" "}
                    {task.stalledDays} 天
                  </div>
                </div>
                <span
                  className="ml-auto inline-flex shrink-0 items-center whitespace-nowrap rounded-full px-2.5 py-0.5 text-[12px] font-semibold"
                  style={{
                    background: "rgba(255, 176, 32, 0.12)",
                    color: "#a66b00",
                  }}
                >
                  停留 {task.stalledDays} 天
                </span>
              </div>
            ))}
          </div>
        )}

        <div className="mt-3 border-t border-[#e1e3e6] pt-2.5">
          <Link
            href={kanbanHref}
            className="text-[13px] font-medium text-[#7d2ae8] no-underline hover:underline"
          >
            处理或关闭这些任务 · 前往 Kanban →
          </Link>
        </div>
      </section>

      <InfoCallout className="mt-4">{TEAM_FOOTER_NOTE}</InfoCallout>
    </>
  );
}

/**
 * 空间 Analysis 展示（个人 / 团队共用）。
 *
 * 纯服务端组件：只消费已序列化的 DTO，按 `variant` 分支渲染；
 * 唯一交互（时间范围切换）下沉到 `AnalysisRangeSelector`。
 */
export function SpaceAnalysis({
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
