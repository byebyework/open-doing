import type { ReactNode } from "react";

/** NavSection 入参。 */
export interface NavSectionProps {
  /** 分组标题（全大写样式由组件统一处理）。 */
  title: string;
  /** 分组内的导航项。 */
  children: ReactNode;
}

/**
 * 侧栏通用导航分组容器：标题 + 子项。
 *
 * 只负责排版，不感知路由与数据；P（个人）与 T（团队）轨道
 * 各自在导航桩文件内使用本组件组织分组。
 */
export function NavSection({ title, children }: NavSectionProps) {
  return (
    <div className="flex flex-col">
      <div className="px-3 pb-1 pt-3 text-[11px] font-semibold uppercase tracking-[0.06em] text-[#9aa0a6]">
        {title}
      </div>
      {children}
    </div>
  );
}
