import { readFileSync } from "node:fs";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, it } from "vitest";

import zh from "@/i18n/messages/zh.json";

const { StatusTag } = await import("./StatusTag");
const { ProgressBar } = await import("./ProgressBar");
const { ConfirmModal } = await import("./ConfirmModal");

function withIntl(ui: React.ReactElement): React.ReactElement {
  return (
    <NextIntlClientProvider locale="zh" messages={zh}>
      {ui}
    </NextIntlClientProvider>
  );
}

describe("共享原子件换芯(antd → shadcn,公开 props 不变)", () => {
  it("StatusTag 渲染 shadcn Badge(pill、无 antd 类名)", () => {
    const html = renderToStaticMarkup(withIntl(<StatusTag status="todo" />));

    expect(html).toContain('data-slot="badge"');
    expect(html).toContain("未开始");
    // pill 形态:任意值 radius 取 tokens pill 槽位
    expect(html).toContain("rounded-[var(--radius-pill)]");
    expect(html).not.toContain("ant-");
  });

  it("ProgressBar 渲染 shadcn Progress 且保留 aria-label", () => {
    const html = renderToStaticMarkup(
      withIntl(<ProgressBar value={0.42} />),
    );

    expect(html).toContain('data-slot="progress"');
    expect(html).toContain("aria-label");
    expect(html).not.toContain("ant-");
  });

  it("ConfirmModal 关闭态可安全 SSR 且不含 antd 标记", () => {
    const html = renderToStaticMarkup(
      withIntl(
        <ConfirmModal
          open={false}
          title="删除任务"
          content="确认删除?"
          danger
          onConfirm={() => {}}
          onCancel={() => {}}
        />,
      ),
    );

    expect(html).not.toContain("ant-");
  });

  it("三个组件源文件不再 import antd", () => {
    for (const file of ["StatusTag.tsx", "ProgressBar.tsx", "ConfirmModal.tsx"]) {
      const source = readFileSync(path.join(import.meta.dirname, file), "utf8");
      expect(source, `${file} 仍引用 antd`).not.toMatch(/from "antd"/);
    }
  });
});
