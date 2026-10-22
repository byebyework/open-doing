"use client";

import { Dropdown } from "antd";
import type { MenuProps } from "antd";

/** 空间切换菜单项：按原型静态渲染，暂不接路由与数据。 */
const items: MenuProps["items"] = [
  {
    type: "group",
    label: "个人",
    children: [{ key: "personal", label: "个人空间" }],
  },
  {
    type: "group",
    label: "我的团队",
    children: [
      {
        key: "team-growth",
        label: (
          <span className="flex items-center gap-2">
            <span className="h-2 w-2 shrink-0 rounded-full bg-[#9b87f5]" />
            增长突击队
          </span>
        ),
      },
    ],
  },
  { type: "divider" },
  { key: "create-team", label: "＋ 创建团队" },
];

/**
 * 侧栏空间切换器（F-5 静态版）。
 *
 * 菜单结构与原型一致：个人空间 / 我的团队 / 创建团队；
 * 当前选中项固定为「个人空间」，点击行为由 P/T 轨道接线。
 */
export function SpaceSwitcher() {
  return (
    <Dropdown
      trigger={["click"]}
      menu={{
        items,
        selectable: true,
        selectedKeys: ["personal"],
      }}
    >
      <button
        type="button"
        className="mx-2 mb-2 flex w-[calc(100%-1rem)] items-center gap-2 rounded-lg border border-[#e1e3e6] bg-white px-2.5 py-2 text-left text-[13px] transition-colors hover:border-[#c7cdd3] hover:bg-[#f4f5f7]"
      >
        <span className="h-2 w-2 shrink-0 rounded-full bg-[#7d2ae8]" />
        <span className="min-w-0 flex-1 truncate font-semibold text-[#0e1318]">
          个人空间
        </span>
        <svg
          width="11"
          height="11"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="shrink-0 text-[#9aa0a6]"
          aria-hidden="true"
        >
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>
    </Dropdown>
  );
}
