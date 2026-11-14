import { cn } from "@/lib/utils";

/** UserAvatar 入参。 */
export interface UserAvatarProps {
  /** 用户 ID：只用于头像底色哈希，改名 / 改昵称都不影响颜色。 */
  userId: string;
  /** 展示名（调用方传 `displayName(user)`）：取首个字符作为头像文字。 */
  name: string;
  /** 头像边长（px），默认 30。 */
  size?: number;
  /** 附加样式：仅用于调整圆角等外观（如详情页 xl 头像的 12px 圆角）。 */
  className?: string;
}

/** 6 个分类点缀色：5 个 accent + 品牌紫（与原型 av-* 类一致）。 */
export const ACCENT_COLORS = [
  "#ff7059", // coral
  "#ff9633", // tangerine
  "#48c997", // mint
  "#3ea6ff", // sky
  "#9b87f5", // lavender
  "#7d2ae8", // purple
] as const;

/**
 * 用户 ID 哈希（FNV-1a + 末尾混淆）。
 *
 * 同一用户恒定映射到同一颜色；以 userId 为种子，昵称变化不会让颜色漂移。
 */
function hashSeed(seed: string): number {
  let hash = 2166136261;
  for (let i = 0; i < seed.length; i += 1) {
    hash ^= seed.charCodeAt(i);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  hash ^= hash >>> 16;
  return hash >>> 0;
}

/** 由 userId 决定的头像点缀色（与展示名无关）。 */
export function avatarColor(userId: string): string {
  return ACCENT_COLORS[hashSeed(userId) % ACCENT_COLORS.length];
}

/**
 * 用户头像：展示名首字 + 由 userId 哈希决定的点缀色圆形背景。
 *
 * 纯展示组件（无交互），可在服务端组件中直接使用。
 */
export function UserAvatar({
  userId,
  name,
  size = 30,
  className,
}: UserAvatarProps) {
  const firstChar = Array.from(name.trim())[0] ?? "?";
  const backgroundColor = avatarColor(userId);

  return (
    <span
      role="img"
      aria-label={name}
      title={name}
      className={cn(
        "inline-grid shrink-0 select-none place-items-center rounded-full font-bold text-white",
        className,
      )}
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
