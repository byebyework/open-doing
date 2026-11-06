import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ACCENT_COLORS, UserAvatar, avatarColor } from "./UserAvatar";

/** 从 SSR 标记中取出内联 background-color（React 会输出 `background-color:#xxxxxx`）。 */
function backgroundColor(html: string): string {
  const match = /background-color:([^;"]+)/.exec(html);
  if (!match) throw new Error(`未渲染 background-color：${html}`);
  return match[1]!;
}

describe("UserAvatar：底色按 userId 哈希，文字取展示名首字", () => {
  it("同一展示名、不同 userId：底色随 userId 变化", () => {
    // 固定断言这对 id 落在不同色槽，避免 6 色哈希的偶然碰撞。
    expect(avatarColor("user-a")).not.toBe(avatarColor("user-b"));

    const first = renderToStaticMarkup(
      <UserAvatar userId="user-a" name="同名" />,
    );
    const second = renderToStaticMarkup(
      <UserAvatar userId="user-b" name="同名" />,
    );

    expect(backgroundColor(first)).not.toBe(backgroundColor(second));
    expect(backgroundColor(first)).toBe(avatarColor("user-a"));
    expect(backgroundColor(second)).toBe(avatarColor("user-b"));
  });

  it("同一 userId、不同展示名：底色不变（改昵称不漂移），文字与 aria-label 取展示名", () => {
    const first = renderToStaticMarkup(
      <UserAvatar userId="user-a" name="甲" />,
    );
    const second = renderToStaticMarkup(
      <UserAvatar userId="user-a" name="乙" />,
    );

    expect(backgroundColor(first)).toBe(backgroundColor(second));
    expect(backgroundColor(first)).toBe(avatarColor("user-a"));
    expect(first).toContain(">甲<");
    expect(second).toContain(">乙<");
    expect(first).toContain('aria-label="甲"');
    expect(second).toContain('aria-label="乙"');
  });

  it("所有色槽都来自 tokens 对齐的 ACCENT_COLORS", () => {
    const colors = new Set<string>();
    for (const id of ["user-a", "user-b", "user-c", "user-d", "user-e", "user-f"]) {
      colors.add(avatarColor(id));
    }
    for (const color of colors) {
      expect(ACCENT_COLORS).toContain(color);
    }
  });
});
