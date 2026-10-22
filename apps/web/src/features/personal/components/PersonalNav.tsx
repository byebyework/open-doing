import { NavSection } from "@/components/layout/NavSection";

/**
 * 个人空间导航桩（M0 占位）。
 *
 * 所有权归 P 轨道（P-5）：届时替换为「我的任务」+ 个人项目列表 + 新建项目入口。
 * `(dashboard)/layout.tsx` 只 import 本文件，P-5 不得修改布局。
 */
export function PersonalNav() {
  return (
    <NavSection title="个人空间">
      <span className="px-3 py-2 text-[13px] text-[#9aa0a6]">
        个人导航待接入
      </span>
    </NavSection>
  );
}
