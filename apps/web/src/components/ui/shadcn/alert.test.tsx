import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { Alert } from "./alert";

describe("Alert 裸字符串 children", () => {
  // 回归钉:Alert 是 grid-cols-[0_1fr] 网格,官方契约要求内容置于
  // AlertTitle/AlertDescription(col-start-2)。裸字符串会落入 0 宽
  // 首列,逐字竖排。适配:字符串 children 自动包进 AlertTitle。
  it("把裸字符串包进 col-start-2 的 AlertTitle,而不是留给匿名网格项", () => {
    const html = renderToStaticMarkup(<Alert variant="destructive">登录失败</Alert>);

    expect(html).toContain("登录失败");
    // 文本必须出现在带 col-start-2 的元素内部(AlertTitle),且不是 alert 的直接裸子节点
    expect(html).toMatch(/col-start-2[^>]*>登录失败</);
  });
});
