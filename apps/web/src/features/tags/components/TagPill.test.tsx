/**
 * @vitest-environment jsdom
 */
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";

import type { TagColor } from "@open-doing/types";

import { TAG_COLORS } from "@open-doing/types";

import { tagColorStyle } from "./tag-colors";
import { TagPill } from "./TagPill";

/** 沿用仓库 jsdom + act 最小探针写法（无 @testing-library）。 */
function renderPill(name: string, color: TagColor, size?: "sm" | "md") {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  let element: ReturnType<typeof TagPill>;
  act(() => {
    element = size ? <TagPill name={name} color={color} size={size} /> : <TagPill name={name} color={color} />;
    root.render(element);
  });
  return container;
}

describe("tagColorStyle", () => {
  it("六个色全部映射到 token 变量，无字面 hex", () => {
    for (const color of TAG_COLORS) {
      const style = tagColorStyle(color);
      expect(style.color).toMatch(/^var\(--/);
      expect(style.backgroundColor).toMatch(/^var\(--/);
      expect(style.color.includes("#")).toBe(false);
      expect(style.backgroundColor.includes("#")).toBe(false);
    }
    expect(tagColorStyle("purple")).toEqual({
      color: "var(--purple-600)",
      backgroundColor: "var(--purple-08)",
    });
    expect(tagColorStyle("coral")).toEqual({
      color: "var(--accent-coral)",
      backgroundColor: "var(--accent-coral-bg)",
    });
  });
});

describe("TagPill", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("六个色各渲染一次，颜色走 token 变量", () => {
    for (const color of TAG_COLORS) {
      const container = renderPill("调研", color);
      const pill = container.querySelector<HTMLElement>("[data-testid='tag-pill']");
      expect(pill).not.toBeNull();
      expect(pill!.textContent).toContain("调研");
      expect(pill!.style.color).toContain("var(--");
      expect(pill!.style.backgroundColor).toContain("var(--");
    }
  });

  it("size=md 使用更大的内边距", () => {
    const sm = renderPill("A", "mint", "sm");
    const md = renderPill("A", "mint", "md");
    const smPill = sm.querySelector("[data-testid='tag-pill']");
    const mdPill = md.querySelector("[data-testid='tag-pill']");
    expect(mdPill!.className).not.toBe(smPill!.className);
    expect(mdPill!.className).toContain("px-2.5");
    expect(smPill!.className).not.toContain("px-2.5");
  });

  it("未知 color（类型外强塞）回退 purple", () => {
    const container = renderPill("X", "blue" as TagColor);
    const pill = container.querySelector<HTMLElement>("[data-testid='tag-pill']");
    expect(pill!.style.color).toBe("var(--purple-600)");
  });
});
