/**
 * 分析页的非趋势类自绘图表（服务端可渲染，无 "use client"、不依赖图表库）。
 *
 * `HBarList`（横向条列表）与 `WeekMiniBars`（6 根迷你柱）逐项对照
 * `docs/prototypes/space-analysis-{personal,team}.html` 的 `.hbar-*` /
 * `.week-bars` 区块；hover 说明走原生 `title`，不产生客户端 JS。
 * 趋势柱状图已迁移为 recharts 版客户端组件，见 `./trend-chart`。
 */

/** 横向条列表的一行。 */
export interface HBarRow {
  /** React key。 */
  key: string;
  /** 主名（项目名 / 成员名）。 */
  name: string;
  /** 原生悬停文案；缺省为「名称 · 计数」，调用方可传原型口径的完整句式。 */
  title?: string;
  /** 次行说明（成员负载的逾期 / 临期注记）；提供时按双行布局渲染。 */
  sub?: string;
  /** 行内标签（如「团队」）。 */
  tag?: string;
  /** 当前计数。 */
  count: number;
  /** 归一化基准（列表内最大计数）。 */
  max: number;
}

/** 横向条列表：条高 14px、左端方角右端 4px 圆角，宽度 = count/max。 */
export function HBarList({ rows }: { rows: HBarRow[] }) {
  return (
    <div className="min-w-0">
      {rows.map((row, index) => {
        const percent =
          row.max > 0
            ? Math.min(100, Math.max(0, (row.count / row.max) * 100))
            : 0;

        return (
          <div
            key={row.key}
            title={
              row.title ??
              `${row.name}${row.tag ? ` · ${row.tag}` : ""} · ${row.count}`
            }
            className={`flex min-w-0 items-center gap-3 py-[13px] ${
              index > 0 ? "border-t border-[var(--border-default)]" : ""
            }`}
          >
            {row.sub !== undefined ? (
              <div className="w-24 flex-none leading-[1.3]">
                <div className="truncate text-[13.5px] font-semibold text-[var(--ink-900)]">
                  {row.name}
                </div>
                <div className="truncate text-[12px] text-[var(--ink-500)]">
                  {row.sub}
                </div>
              </div>
            ) : (
              <div className="w-[170px] flex-none truncate whitespace-nowrap text-[13.5px] font-semibold text-[var(--ink-900)]">
                {row.name}
                {row.tag ? (
                  <span
                    className="ml-1.5 inline-flex items-center rounded-full px-2.5 py-0.5 align-middle text-[12px] font-medium"
                    style={{
                      background: "rgba(155, 135, 245, 0.14)",
                      color: "#6d4fd4",
                    }}
                  >
                    {row.tag}
                  </span>
                ) : null}
              </div>
            )}

            <div className="flex min-w-0 flex-1 items-center gap-2">
              {percent > 0 ? (
                <div
                  style={{
                    width: `${percent}%`,
                    height: 14,
                    minWidth: 2,
                    background: "var(--purple-600)",
                    borderRadius: "0 4px 4px 0",
                  }}
                />
              ) : null}
              <b
                className="flex-none text-[12.5px] font-semibold text-[#3c4043]"
                style={{ fontVariantNumeric: "tabular-nums" }}
              >
                {row.count}
              </b>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** 6 根 6px 宽迷你柱：高 = 值 × 4px，0 值跳过。 */
export function WeekMiniBars({
  values,
  title,
}: {
  values: number[];
  title?: string;
}) {
  return (
    <span
      className="inline-flex items-end gap-[3px]"
      style={{ height: 14 }}
      title={title}
    >
      {values.map((value, index) =>
        value > 0 ? (
          <i
            key={index}
            className="inline-block"
            style={{
              width: 6,
              height: value * 4,
              background: "var(--purple-600)",
              borderRadius: "2px 2px 0 0",
              opacity: 0.85,
            }}
          />
        ) : null,
      )}
    </span>
  );
}
