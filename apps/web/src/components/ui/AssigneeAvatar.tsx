"use client";

import type { AssigneeRef } from "@open-doing/types";
import { BotIcon } from "lucide-react";
import { useTranslations } from "next-intl";

import { cn } from "@/lib/utils";

import { UserAvatar } from "./UserAvatar";

/** 头像边长：`sm` / `md` 别名，或直接传像素值（日历等紧凑视图复用）。 */
export type AssigneeAvatarSize = "sm" | "md" | number;

const SIZE_MAP: Record<"sm" | "md", number> = {
  sm: 22,
  md: 26,
};

/**
 * 虚拟成员未设置头像色时的回退色。
 *
 * 与 `VirtualMemberManager` 的默认色一致；属于仓库有意保留字面色值的
 * 头像调色板（无对应 token）。
 */
const DEFAULT_VIRTUAL_ACCENT_COLOR = "#a66b00";

export interface AssigneeAvatarProps {
  /**
   * 责任人身份引用；未指派 / 责任人已被移除时为 null。
   *
   * 不用 `ref` 作为 prop 名：React 会把 JSX `ref` 当作特殊属性（React
   * Compiler 也会拒绝在渲染期访问名为 ref 的变量）。
   */
  assigneeRef: AssigneeRef | null;
  /** 头像边长：`sm`（22px）/ `md`（26px），或直接传像素值。默认 `md`。 */
  size?: AssigneeAvatarSize;
  /**
   * 未指派占位的 aria-label 覆盖值（缺省取 `tasks.unassigned`）。
   *
   * 评论等场景里 null 表示「作者已被移除」而非「未指派」，调用方可传
   * 对应文案。
   */
  nullLabel?: string;
  className?: string;
}

function resolveSize(size: AssigneeAvatarSize | undefined): number {
  if (typeof size === "number") return size;
  return SIZE_MAP[size ?? "md"];
}

/** 虚拟成员头像：首字符 + accentColor 底色 + 右下角小机器人角标。 */
function VirtualAvatar({
  name,
  accentColor,
  size,
}: {
  name: string;
  accentColor: string | null;
  size: number;
}) {
  const t = useTranslations("tasks");
  const firstChar = Array.from(name.trim())[0] ?? "?";
  const badgeSize = Math.max(8, Math.round(size * 0.42));
  const badgeOffset = Math.max(2, Math.round(size * 0.14));

  return (
    <span className="relative inline-flex shrink-0">
      <span
        role="img"
        aria-label={name}
        title={name}
        className="inline-grid select-none place-items-center rounded-full font-bold text-white"
        style={{
          width: size,
          height: size,
          fontSize: Math.max(9, Math.round(size * 0.4)),
          backgroundColor: accentColor ?? DEFAULT_VIRTUAL_ACCENT_COLOR,
        }}
      >
        {firstChar}
      </span>
      <span
        data-testid="assignee-avatar-bot-badge"
        role="img"
        aria-label={t("virtualMemberBadgeAria")}
        className="absolute grid place-items-center rounded-full bg-[var(--ink-900)] text-white"
        style={{
          width: badgeSize,
          height: badgeSize,
          right: -badgeOffset,
          bottom: -badgeOffset,
        }}
      >
        <BotIcon
          aria-hidden="true"
          style={{
            width: Math.max(5, Math.round(badgeSize * 0.62)),
            height: Math.max(5, Math.round(badgeSize * 0.62)),
          }}
        />
      </span>
    </span>
  );
}

/**
 * 责任人头像（纯展示）。
 *
 * - 真人：复用 `UserAvatar` 的首字 + userId 哈希底色（不渲染网络头像，
 *   与全站现有真人头像一致）；
 * - 虚拟成员：首字符 + accentColor 底色 + 机器人角标（accentColor 为空时
 *   回退到虚拟成员默认色，不按名称哈希）；
 * - null（未指派 / 责任人被移除）：虚线圆 + `?` 占位。
 */
export function AssigneeAvatar({
  assigneeRef,
  size,
  nullLabel,
  className,
}: AssigneeAvatarProps) {
  const t = useTranslations("tasks");
  const px = resolveSize(size);

  if (assigneeRef === null) {
    const label = nullLabel ?? t("unassigned");

    return (
      <span
        role="img"
        aria-label={label}
        title={label}
        className={cn(
          "inline-grid shrink-0 select-none place-items-center rounded-full border border-dashed border-[var(--border-default)] font-bold text-[var(--ink-400)]",
          className,
        )}
        style={{
          width: px,
          height: px,
          fontSize: Math.max(9, Math.round(px * 0.4)),
        }}
      >
        ?
      </span>
    );
  }

  if (assigneeRef.type === "virtual") {
    return (
      <VirtualAvatar
        name={assigneeRef.name}
        accentColor={assigneeRef.accentColor}
        size={px}
      />
    );
  }

  return (
    <UserAvatar
      userId={assigneeRef.userId}
      name={assigneeRef.name}
      size={px}
      className={className}
    />
  );
}
