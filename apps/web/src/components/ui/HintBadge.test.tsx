import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { HintBadge } from "./HintBadge";

/**
 * 本仓库 vitest 环境是 node（无 jsdom / testing-library），无法模拟点击；
 * 且 Radix Popover 内容经 Portal 渲染，SSR 即使 open 也不会出现在静态标记里。
 * 因此单测覆盖 SSR 可断言的部分：触发器常驻、summary 与 ariaLabel 可访问名、
 * 关闭态内容不落文档、token 着色；展开态（点击后可见 title/items）由
 * e2e 流程覆盖（Task 13）。
 */
const SUMMARY = "13 个未完成";
const ARIA_LABEL = "统计口径说明";
const TITLE = "口径详情";
const FIRST_ITEM = "已完成按近 7 天统计";

function renderHint(): string {
  return renderToStaticMarkup(
    <HintBadge
      ariaLabel={ARIA_LABEL}
      summary={SUMMARY}
      title={TITLE}
      items={[FIRST_ITEM, "即将到期为 3 天内"]}
    />,
  );
}

describe("HintBadge（SSR 关闭态）", () => {
  it("触发器常驻：button 带 ariaLabel 可访问名与 summary 摘要", () => {
    const html = renderHint();

    expect(html).toMatch(/<button[^>]*type="button"/);
    expect(html).toContain(`aria-label="${ARIA_LABEL}"`);
    expect(html).toContain(SUMMARY);
    // Radix Trigger 的 popover 语义属性（可访问名之外的可展开提示）。
    expect(html).toContain('data-slot="popover-trigger"');
    expect(html).toContain('aria-haspopup="dialog"');
    expect(html).toContain('aria-expanded="false"');
  });

  it("关闭态：Portal 内容不渲染进文档，点开前不泄露标题/条目", () => {
    const html = renderHint();

    expect(html).not.toContain(TITLE);
    expect(html).not.toContain(FIRST_ITEM);
    expect(html).not.toContain('data-slot="popover-content"');
  });

  it("无 summary 时触发器仍以 ariaLabel 为可访问名（纯图标 ⓘ）", () => {
    const html = renderToStaticMarkup(
      <HintBadge ariaLabel={ARIA_LABEL} title={TITLE} items={[FIRST_ITEM]} />,
    );

    expect(html).toContain(`aria-label="${ARIA_LABEL}"`);
    expect(html).not.toContain(SUMMARY);
    // ⓘ 图标以 currentColor 绘制，无内联十六进制色值。
    expect(html).toMatch(/<svg[^>]*>/);
    expect(html).not.toMatch(/#[0-9a-fA-F]{3,6}/);
  });

  it("着色只走 token 变量（ink / border / radius），无字面量十六进制", () => {
    const html = renderHint();

    expect(html).toContain("var(--ink-");
    expect(html).not.toMatch(/#[0-9a-fA-F]{3,6}/);
  });
});
