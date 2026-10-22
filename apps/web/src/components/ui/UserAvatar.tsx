/** UserAvatar 入参。 */
export interface UserAvatarProps {
  /** 用户名：取首个字符作为头像文字。 */
  username: string;
  /** 头像边长（px），默认 30。 */
  size?: number;
}

/** 6 个分类点缀色：5 个 accent + 品牌紫（与原型 av-* 类一致）。 */
const ACCENT_COLORS = [
  "#ff7059", // coral
  "#ff9633", // tangerine
  "#48c997", // mint
  "#3ea6ff", // sky
  "#9b87f5", // lavender
  "#7d2ae8", // purple
] as const;

/**
 * 用户名哈希（FNV-1a + 末尾混淆）。
 *
 * 同一用户名恒定映射到同一颜色，并让短中文名的颜色分布更均匀。
 */
function hashUsername(username: string): number {
  let hash = 2166136261;
  for (let i = 0; i < username.length; i += 1) {
    hash ^= username.charCodeAt(i);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  hash ^= hash >>> 16;
  return hash >>> 0;
}

/**
 * 用户头像：用户名首字 + 由用户名哈希决定的点缀色圆形背景。
 *
 * 纯展示组件（无交互），可在服务端组件中直接使用。
 */
export function UserAvatar({ username, size = 30 }: UserAvatarProps) {
  const firstChar = Array.from(username.trim())[0] ?? "?";
  const backgroundColor =
    ACCENT_COLORS[hashUsername(username) % ACCENT_COLORS.length];

  return (
    <span
      role="img"
      aria-label={username}
      title={username}
      className="inline-grid shrink-0 select-none place-items-center rounded-full font-bold text-white"
      style={{
        width: size,
        height: size,
        fontSize: Math.max(10, Math.round(size * 0.4)),
        backgroundColor,
      }}
    >
      {firstChar}
    </span>
  );
}
