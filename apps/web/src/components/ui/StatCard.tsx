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
}

/**
 * Dashboard 顶部统计卡（只读展示）。
 *
 * 个人空间与团队空间的 Dashboard 共用同一视觉：白底卡片 + 小号标签 +
 * 大号数值 + 灰色说明。数值颜色由调用方按语义传入（临期黄 / 逾期红 /
 * 完成绿 / 品牌紫）。
 */
export function StatCard({ label, value, hint, color }: StatCardProps) {
  return (
    <div className="min-w-0 rounded-xl border border-[var(--border-default)] bg-white p-4 shadow-[var(--shadow-rest)] min-[861px]:p-5">
      <div className="text-[12.5px] text-[var(--ink-500)]">{label}</div>
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
