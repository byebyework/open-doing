import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const globalsCss = readFileSync(path.join(import.meta.dirname, "globals.css"), "utf8");
const tokensCss = readFileSync(path.join(import.meta.dirname, "tokens.css"), "utf8");

describe("globals.css @theme 桥", () => {
  // 回归钉(共存期零回归):Tailwind 4 的 rounded-sm/md/lg/xl 默认编译为
  // var(--radius-sm/md/lg/xl)。若 @theme 重定义这些名字,存量页面(大量
  // 使用 rounded-md/lg/xl)的圆角会在未换用任何 shadcn 组件时被全局改写。
  // shadcn 组件需要的 token 圆角以 rounded-[var(--radius-N)] 任意值直接取用。
  it("不重定义 Tailwind 默认 radius 槽位(避免存量页面圆角全局漂移)", () => {
    const themeBlock = globalsCss.match(/@theme[^{]*\{[\s\S]*?\n\}/)?.[0] ?? "";
    expect(themeBlock).not.toBe("");
    expect(themeBlock).not.toMatch(/--radius-(sm|md|lg|xl)\s*:/);
  });

  // 同一根源的第二条通路:tokens.css 是未分层样式,其 :root 声明会压过
  // layer(theme) 的 Tailwind 默认值——tokens.css 里出现 --radius-md/lg/xl
  // 等同于全局改写 rounded-md/lg/xl。原型 design-tokens.css 的 shadcn 派生
  // 槽位只在原型静态页生效(不跑 Tailwind),运行时必须省略。
  // (--radius-sm 例外:它是迁移前就存在的语义槽位,保持原状。)
  it("tokens.css 不定义与 Tailwind 默认 radius 工具类冲突的槽位", () => {
    expect(tokensCss).not.toMatch(/--radius-(md|lg|xl)\s*:/);
  });
});
