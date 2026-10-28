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
    <div className="min-w-0 rounded-xl border border-[#e1e3e6] bg-white p-4 shadow-[0_1px_3px_rgba(14,19,24,0.04)] min-[861px]:p-5">
      <div className="text-[12.5px] text-[#5f6368]">{label}</div>
      <div
        className="mt-1 text-[28px] font-bold leading-none tracking-[-0.01em] text-[#0e1318]"
        style={color ? { color } : undefined}
      >
        {value}
      </div>
      <div className="mt-2 text-[12px] text-[#9aa0a6]">{hint}</div>
    </div>
  );
}
