import type { TagColor } from "@open-doing/types";

/**
 * 标签色板 -> token CSS 变量的唯一映射来源（spec §6.6）。
 *
 * 全部取自 `apps/web/src/app/tokens.css` 既有变量：品牌紫 + 5 个 accent 色，
 * 每色配套半透明底色变体。零字面 hex；新增颜色时先补 token 再改这里。
 */
const TAG_COLOR_STYLE: Record<TagColor, { color: string; backgroundColor: string }> = {
  purple: { color: "var(--purple-600)", backgroundColor: "var(--purple-08)" },
  coral: { color: "var(--accent-coral)", backgroundColor: "var(--accent-coral-bg)" },
  tangerine: {
    color: "var(--accent-tangerine)",
    backgroundColor: "var(--accent-tangerine-bg)",
  },
  mint: { color: "var(--accent-mint)", backgroundColor: "var(--accent-mint-bg)" },
  sky: { color: "var(--accent-sky)", backgroundColor: "var(--accent-sky-bg)" },
  lavender: {
    color: "var(--accent-lavender)",
    backgroundColor: "var(--accent-lavender-bg)",
  },
};

/** 颜色 key -> 文字 / 底色 token 变量；未知 key 回退品牌紫。 */
export function tagColorStyle(color: TagColor): { color: string; backgroundColor: string } {
  return TAG_COLOR_STYLE[color] ?? TAG_COLOR_STYLE.purple;
}
