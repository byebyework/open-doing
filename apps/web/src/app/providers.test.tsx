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
});
