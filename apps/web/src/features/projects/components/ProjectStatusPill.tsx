"use client";

import type { ProjectStatus } from "@open-doing/types";
import { PROJECT_STATUSES } from "@open-doing/types";
import {
  CircleCheckIcon,
  CircleDashedIcon,
  CirclePlayIcon,
  CircleXIcon,
  CircleIcon,
  CheckIcon,
} from "lucide-react";
import { useTranslations } from "next-intl";

import { PROJECT_STATUS_COLORS } from "../constants";
import { AttrPill } from "./AttrPill";

/** 状态图标（对照 Linear：虚线圈/空心圆/黄色实心/蓝勾/灰叉；配色走 token）。 */
const STATUS_ICONS: Record<ProjectStatus, React.ReactNode> = {
  backlog: <CircleDashedIcon className="size-3.5" aria-hidden="true" />,
  planned: <CircleIcon className="size-3.5" aria-hidden="true" />,
  in_progress: <CirclePlayIcon className="size-3.5" aria-hidden="true" />,
  completed: <CircleCheckIcon className="size-3.5" aria-hidden="true" />,
  canceled: <CircleXIcon className="size-3.5" aria-hidden="true" />,
};

export interface ProjectStatusPillProps {
  status: ProjectStatus;
  /** 就地改回调（列表/Drawer/详情页；不传则仅展示，弹窗内也可传受控回调）。 */
  onChange?: (status: ProjectStatus) => void | Promise<void>;
  disabled?: boolean;
  testid?: string;
  /** 就地改失败的 toast 文案回调（列表/Drawer 用）。 */
  onError?: (message: string) => void;
}

/**
 * 项目状态 pill（对照 Linear 图 21）：展示当前状态（图标+文案+配色），
 * 点击弹 Popover 五态选择；`onChange` 传入时选项点击即回调。
 */
export function ProjectStatusPill({
  status,
  onChange,
  disabled,
  testid = "project-status-pill",
}: ProjectStatusPillProps) {
  const t = useTranslations("projects");

  const statusLabel = (kind: ProjectStatus) =>
    t(
      kind === "backlog"
        ? "statusBacklog"
        : kind === "planned"
          ? "statusPlanned"
          : kind === "in_progress"
            ? "statusInProgress"
            : kind === "completed"
              ? "statusCompleted"
              : "statusCanceled",
    );

  return (
    <AttrPill
      testid={testid}
      icon={
        <span style={{ color: PROJECT_STATUS_COLORS[status] }}>{STATUS_ICONS[status]}</span>
      }
      label={statusLabel(status)}
      valueActive={false}
      disabled={disabled}
    >
      {(close) => (
        <div className="flex flex-col">
          {PROJECT_STATUSES.map((kind) => (
            <button
              key={kind}
              type="button"
              data-testid={`project-status-option-${kind}`}
              className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] transition-colors hover:bg-[var(--color-surface-hover)]"
              onClick={() => {
                if (onChange) void onChange(kind);
                close();
              }}
            >
              <span style={{ color: PROJECT_STATUS_COLORS[kind] }}>
                {STATUS_ICONS[kind]}
              </span>
              <span className="flex-1">{statusLabel(kind)}</span>
              {kind === status ? (
                <CheckIcon className="size-3.5 text-[var(--color-text)]" aria-hidden="true" />
              ) : null}
            </button>
          ))}
        </div>
      )}
    </AttrPill>
  );
}
