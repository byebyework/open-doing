import { renderToStaticMarkup } from "react-dom/server";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

import zh from "@/i18n/messages/zh.json";

const { KanbanStatStrip } = await import("./KanbanStatStrip");

function withIntl(ui: React.ReactElement): React.ReactElement {
  return (
    <NextIntlClientProvider locale="zh" messages={zh}>
      {ui}
    </NextIntlClientProvider>
  );
}

const STATS = {
  todo: 6,
  inProgress: 5,
  doneRecent: 4,
  overdue: 2,
  dueSoon: 3,
};

describe("KanbanStatStrip（统计即筛选）", () => {
  it("渲染五个 chip，data-filter 对齐原型，计数取自 stats", () => {
    const html = renderToStaticMarkup(
      withIntl(
        <KanbanStatStrip
          stats={STATS}
          today="2026-10-21"
          active={{}}
          basePath="/space/personal/kanban"
          preserveParams={{}}
        />,
      ),
    );

    for (const filter of [
      "status:todo",
      "status:in_progress",
      "status:done",
      "overdue",
      "due-soon",
    ]) {
      expect(html).toContain(`data-filter="${filter}"`);
    }

    // 计数逐 chip 落位（aria-label 前缀标签 + value）。
    expect(html).toContain(">6<");
    expect(html).toContain(">5<");
    expect(html).toContain(">4<");
    expect(html).toContain(">2<");
    expect(html).toContain(">3<");

    // 原型口径说明一行。
    expect(html).toContain("口径：已完成按近 7 天 · 即将到期为 3 天内 · 点击数字即筛选");
  });

  it("aria-pressed 标记激活 chip（status:todo 激活、其余未激活）", () => {
    const html = renderToStaticMarkup(
      withIntl(
        <KanbanStatStrip
          stats={STATS}
          today="2026-10-21"
          active={{ status: "todo" }}
          basePath="/space/personal/kanban"
          preserveParams={{}}
        />,
      ),
    );

    expect(html).toMatch(
      /data-filter="status:todo"[^>]*aria-pressed="true"/,
    );
    expect(html).toMatch(
      /data-filter="overdue"[^>]*aria-pressed="false"/,
    );
  });

  it("overdue / due-soon 的计数带语义色（error / warning）", () => {
    const html = renderToStaticMarkup(
      withIntl(
        <KanbanStatStrip
          stats={STATS}
          today="2026-10-21"
          active={{}}
          basePath="/space/personal/kanban"
          preserveParams={{}}
        />,
      ),
    );

    expect(html).toContain("var(--error)");
    expect(html).toContain("#a66b00");
  });
});
