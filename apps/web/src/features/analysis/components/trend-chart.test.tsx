import { renderToStaticMarkup } from "react-dom/server";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, it, vi } from "vitest";

import zh from "@/i18n/messages/zh.json";

import type { TrendBucket } from "../buckets";

/**
 * recharts 的 ResponsiveContainer 依赖 componentDidMount 测量容器尺寸，
 * `renderToStaticMarkup` 下只会渲染一个空的 responsive div（无子图表）。
 * 因此把这个容器替换为固定尺寸的透传：克隆 BarChart 并注入
 * width/height，其余 recharts 组件走真实实现（真实 SSR 布局/坐标轴）。
 */
vi.mock("recharts", async (importOriginal) => {
  const React = await import("react");
  const actual = await importOriginal<typeof import("recharts")>();

  return {
    ...actual,
    ResponsiveContainer: (props: {
      children?: React.ReactElement<{ width?: number; height?: number }>;
    }) =>
      props.children
        ? React.cloneElement(props.children, { width: 640, height: 260 })
        : null,
  };
});

const { TrendChart } = await import("./trend-chart");

function withIntl(ui: React.ReactElement): React.ReactElement {
  return (
    <NextIntlClientProvider locale="zh" messages={zh}>
      {ui}
    </NextIntlClientProvider>
  );
}

/** 生成自 `2026-11-01` 起的逐日桶。 */
function dailyBuckets(count: number): TrendBucket[] {
  return Array.from({ length: count }, (_, index) => {
    const day = String(index + 1).padStart(2, "0");
    const label = `2026-11-${day}`;
    return { label, start: label, end: label };
  });
}

describe("TrendChart（recharts 版趋势柱状图）", () => {
  it("单系列今日桶：rect 的 title 为「今天 2026-11-14 · 完成 1」", () => {
    const buckets = dailyBuckets(14);
    const values = [...Array<number>(13).fill(0), 1];

    const html = renderToStaticMarkup(
      withIntl(
        <TrendChart
          buckets={buckets}
          series={[{ tone: "primary", values }]}
          todayIndex={13}
        />,
      ),
    );

    expect(html).toContain('title="今天 2026-11-14 · 完成 1"');
  });

  it("valueTemplate / emptyLabel 覆盖单系列悬停文案", () => {
    const buckets = dailyBuckets(14);
    const values = [0, 2, ...Array<number>(12).fill(0)];

    const html = renderToStaticMarkup(
      withIntl(
        <TrendChart
          buckets={buckets}
          series={[{ tone: "primary", values }]}
          todayIndex={0}
          axisDensity="narrow"
          valueTemplate="{value} 项到期"
          emptyLabel="无"
        />,
      ),
    );

    expect(html).toContain('title="今天 2026-11-01 · 无"');
    expect(html).toContain('title="2026-11-02 · 2 项到期"');
  });

  it("全 0 数据：y 轴 0 刻度仍贴在底部基线（domain 不退化为 [0,0]）", () => {
    const buckets = dailyBuckets(7);
    const values = Array<number>(7).fill(0);

    const html = renderToStaticMarkup(
      withIntl(
        <TrendChart
          buckets={buckets}
          series={[{ tone: "primary", values }]}
        />,
      ),
    );

    // 绘图区高 206（260 - top margin 24 - x 轴 30），底部基线 y = 24 + 206 = 230；
    // 退化 domain [0,0] 会把唯一的 0 刻度映射到垂直中点（y = 127）。
    expect(html).toMatch(/<text[^>]*orientation="left"[^>]*y="230"[^>]*>/);
    expect(html).not.toMatch(/<text[^>]*orientation="left"[^>]*y="127"/);
    // ticks 仍按 maxValue 计算，不应出现凭空多出的 "1" 刻度。
    expect(html).not.toMatch(/<text[^>]*orientation="left"[^>]*>[^<]*<tspan[^>]*>1<\/tspan>/);
  });

  it("x 轴首桶、末桶显示完整日期，中间桶显示 MM-DD", () => {
    const buckets = dailyBuckets(30);
    const values = Array<number>(30).fill(0);

    const html = renderToStaticMarkup(
      withIntl(
        <TrendChart
          buckets={buckets}
          series={[{ tone: "primary", values }]}
        />,
      ),
    );

    expect(html).toContain(">2026-11-01<");
    expect(html).toContain(">11-06<");
    expect(html).toContain(">2026-11-30<");
  });
});
