import type { ReactNode } from "react";

/** 图标底色语义（管理概览的四张统计卡按原型使用不同色组）。 */
export type StatCardIconTone = "purple" | "lavender" | "mint" | "info";

/** 图标底色 → tokens.css 色组；静态完整类名便于 Tailwind 扫描。 */
const ICON_TONE_CLASS: Record<StatCardIconTone, string> = {
  purple: "bg-[var(--primary-bg)] text-[var(--purple-600)]",
  lavender: "bg-[var(--accent-lavender-bg)] text-[var(--accent-lavender)]",
  mint: "bg-[var(--accent-mint-bg)] text-[var(--accent-mint)]",
  info: "bg-[var(--info-bg)] text-[var(--info)]",
};

/** 顶部统计卡入参。 */
export interface StatCardProps {
  /** 指标名（如「进行中」）。 */
  label: string;
  /** 指标值（数字或已格式化的字符串，如「72%」）。 */
  value: string | number;
  /** 指标下方的补充说明。 */
  hint: string;
  /** 数值颜色；缺省为正文色。 */
  color?: string;
  /** 标签左侧的 26px 图标槽（可选；管理概览使用）。 */
  icon?: ReactNode;
  /** 图标底色语义；仅在传入 `icon` 时生效，缺省为品牌紫。 */
  iconTone?: StatCardIconTone;
}

/**
 * Dashboard 顶部统计卡（只读展示）。
 *
 * 个人空间与团队空间的 Dashboard 共用同一视觉：白底卡片 + 小号标签 +
 * 大号数值 + 灰色说明。数值颜色由调用方按语义传入（临期黄 / 逾期红 /
 * 完成绿 / 品牌紫）。管理概览额外使用 `icon` / `iconTone` 在标签左侧
 * 渲染色块图标，其余页面不传则保持原样。
 */
export function StatCard({
  label,
  value,
  hint,
  color,
  icon,
  iconTone = "purple",
}: StatCardProps) {
  return (
    <div className="min-w-0 rounded-xl border border-[var(--border-default)] bg-white p-4 shadow-[var(--shadow-rest)] min-[861px]:p-5">
      <div className="flex items-center gap-2">
        {icon ? (
          <span
            className={`grid size-[26px] shrink-0 place-items-center rounded-[var(--radius-6)] ${ICON_TONE_CLASS[iconTone]}`}
          >
            {icon}
          </span>
        ) : null}
        <span className="text-[12.5px] font-medium text-[var(--ink-500)]">
          {label}
        </span>
      </div>
      <div
        className="mt-1 text-[28px] font-bold leading-none tracking-[-0.01em] text-[var(--ink-900)]"
        style={color ? { color } : undefined}
      >
        {value}
      </div>
      <div className="mt-2 text-[12px] text-[var(--ink-400)]">{hint}</div>
    </div>
  );
}
