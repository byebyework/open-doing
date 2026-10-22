import type { ReactNode } from "react";

/** EmptyState 入参。 */
export interface EmptyStateProps {
  /** 主标题（如「暂无任务」）。 */
  title: string;
  /** 辅助说明。 */
  description?: string;
  /** 操作区（如「新建任务」按钮）。 */
  action?: ReactNode;
}

/**
 * 空状态：图标 + 标题 + 可选说明与操作。
 *
 * 纯展示组件，不绑定具体业务文案；调用方决定是否需要操作按钮。
 */
export function EmptyState({ title, description, action }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center px-4 py-12 text-center">
      <span className="mb-3 grid h-14 w-14 place-items-center rounded-full bg-[#eef0fc] text-[#7d2ae8]">
        <svg
          width="26"
          height="26"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
          <path d="M9 13h6" />
        </svg>
      </span>
      <div className="text-[15px] font-semibold text-[#0e1318]">{title}</div>
      {description ? (
        <p className="mt-1.5 max-w-[320px] text-[13.5px] text-[#5f6368]">
          {description}
        </p>
      ) : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}
