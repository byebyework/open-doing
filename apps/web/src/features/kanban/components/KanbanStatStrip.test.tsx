/**
 * @vitest-environment jsdom
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { pushMock, searchParamsMock } = vi.hoisted(() => ({
  pushMock: vi.fn<(url: string) => void>(),
  searchParamsMock: vi.fn<() => URLSearchParams>(() => new URLSearchParams()),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock, refresh: vi.fn() }),
  useSearchParams: () => searchParamsMock(),
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

    // 口径说明收敛为 HintBadge：SSR 只可见触发器摘要与可访问名，
    // 明细（已完成只统计近 7 天完成的任务…）留在 Portal 内，点开前不落文档。
    expect(html).toContain('aria-label="统计口径说明"');
    expect(html).toContain("统计口径");
    expect(html).not.toContain("已完成只统计近 7 天完成的任务");
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

  // —— view 贯通：统计条导航不得丢掉 TasksViewTabs 写入的 ?view=list ——
  // 仓库 vitest 默认 node 环境（无 @testing-library），交互用例沿用
  // LanguageSwitch.test.tsx 的 jsdom + act 最小探针：真实挂载、点原生按钮、
  // 读 router.push 收到的 URL。

  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    pushMock.mockClear();
    searchParamsMock.mockReturnValue(new URLSearchParams());
  });

  function renderStrip(): void {
    act(() => {
      root.render(
        withIntl(
          <KanbanStatStrip
            stats={STATS}
            today="2026-10-21"
            active={{}}
            basePath="/space/personal/tasks"
            preserveParams={{}}
          />,
        ),
      );
    });
  }

  function chipButton(filter: string): HTMLButtonElement {
    const element = container.querySelector<HTMLButtonElement>(
      `[data-filter="${filter}"]`,
    );
    if (!element) throw new Error(`missing chip ${filter}`);
    return element;
  }

  it("view=list 时点击 chip：push 的 URL 保留 view=list", async () => {
    searchParamsMock.mockReturnValue(new URLSearchParams("view=list"));
    renderStrip();

    await act(async () => {
      chipButton("status:todo").click();
    });

    expect(pushMock).toHaveBeenCalledTimes(1);
    expect(pushMock.mock.calls[0]?.[0]).toBe(
      "/space/personal/tasks?status=todo&view=list",
    );
  });

  it("无 view 参数时点击 chip：URL 不含 view（干净地址契约不变）", async () => {
    searchParamsMock.mockReturnValue(new URLSearchParams());
    renderStrip();

    await act(async () => {
      chipButton("status:todo").click();
    });

    expect(pushMock).toHaveBeenCalledTimes(1);
    expect(pushMock.mock.calls[0]?.[0]).toBe("/space/personal/tasks?status=todo");
    expect(pushMock.mock.calls[0]?.[0]).not.toContain("view=");
  });
});
