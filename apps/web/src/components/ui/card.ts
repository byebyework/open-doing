/**
 * 卡片壳（原型 `.card` 规格）：12px 圆角、--border-default 描边、白底、--shadow-rest 阴影。
 * 内边距由使用方按卡片类型补充（p-4 / p-5 / px-4 py-3 …），阴影与描边保持单一来源，
 * 不要在各文件重新内联 rgba 阴影值。
 */
export const CARD_SHELL =
  "rounded-xl border border-[var(--border-default)] bg-white shadow-[var(--shadow-rest)]";
