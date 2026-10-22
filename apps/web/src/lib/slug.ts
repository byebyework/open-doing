const SLUG_MAX_LENGTH = 40;
const SLUG_FALLBACK = "team";

/**
 * 从名称推导 slug：小写、连续 ASCII 字母数字片段以 "-" 连接。
 *
 * 纯中文等无法提取片段的名称回退为 `team`（避免空 slug）；
 * 结果截断至 40 字符。唯一性由调用方查库加计数后缀保证
 * （见 `slugWithCounter` 与 teams service）。
 */
export function slugifyName(name: string): string {
  const fragments = name
    .toLowerCase()
    .match(/[a-z0-9]+/g);

  const slug = (fragments ?? []).join("-").slice(0, SLUG_MAX_LENGTH);
  return slug || SLUG_FALLBACK;
}

/** slug 计数后缀：首个不加，之后追加 `-n`（与个人项目 `name-2` 口径一致）。 */
export function slugWithCounter(base: string, n: number): string {
  return n === 1 ? base : `${base}-${n}`;
}
