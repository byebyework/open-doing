import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import dayjs from "dayjs";

import { Providers } from "./providers";

describe("Providers", () => {
  it("按请求 locale 设置 dayjs 全局 locale（相对时间文案的来源）", () => {
    renderToStaticMarkup(<Providers locale="zh">{null}</Providers>);
    expect(dayjs.locale()).toBe("zh-cn");

    renderToStaticMarkup(<Providers locale="en">{null}</Providers>);
    expect(dayjs.locale()).toBe("en");
  });

  it("mounts MotionConfig with reducedMotion user", () => {
    // 只锁定挂载：渲染不抛错且 children 可见；
    // reduce 行为（跟随系统设置）由 e2e 兜底验证。
    const html = renderToStaticMarkup(
      <Providers locale="zh">
        <p data-testid="probe">children-visible</p>
      </Providers>,
    );
    expect(html).toContain("children-visible");
  });
});
