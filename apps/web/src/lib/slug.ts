/** 所有 slug 都不可用时的兜底根 slug。 */
const FALLBACK_SLUG = "project";

/** 冲突后缀的最大尝试次数，避免回调异常时无限循环。 */
const MAX_SUFFIX_ATTEMPTS = 1000;

/**
 * 将任意文本 ASCII 化为 slug 片段：
 * 小写化 -> 非 `[a-z0-9]` 连续段归一为单个 `-` -> 去掉首尾 `-`。
 *
 * 中文等非 ASCII 字符整体被移除；纯中文输入会得到空串。
 */
function toSlugBase(base: string): string {
  return base
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * 生成在指定作用域内唯一的 slug。
 *
 * - base ASCII 化后为空（如纯中文）时回落为 `project`；
 * - 根 slug 已占用时依次尝试 `-2`、`-3`……直到 `isTaken` 返回 false。
 *
 * `isTaken` 由调用方注入，用于把查重范围限定在个人项目 / 团队项目等作用域内。
 */
export async function generateUniqueSlug(
  base: string,
  isTaken: (slug: string) => Promise<boolean>,
): Promise<string> {
  const root = toSlugBase(base) || FALLBACK_SLUG;

  if (!(await isTaken(root))) return root;

  for (let suffix = 2; suffix <= MAX_SUFFIX_ATTEMPTS; suffix += 1) {
    const candidate = `${root}-${suffix}`;
    if (!(await isTaken(candidate))) return candidate;
  }

  throw new Error("无法生成唯一 slug：冲突次数超出上限");
}
