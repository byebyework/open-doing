import { NavSection } from "@/components/layout/NavSection";

/**
 * 团队空间导航桩（M0 占位）。
 *
 * 所有权归 T 轨道：届时替换为团队列表 / 团队概览 / 项目 / 设置等入口，
 * 并在个人空间上下文（如 `/my`）下自行返回 null。
 * `(dashboard)/layout.tsx` 只 import 本文件，T 轨道不得修改布局。
 */
export function TeamsNav() {
  return (
    <NavSection title="我的团队">
      <span className="px-3 py-2 text-[13px] text-[#9aa0a6]">
        团队导航待接入
      </span>
    </NavSection>
  );
}
