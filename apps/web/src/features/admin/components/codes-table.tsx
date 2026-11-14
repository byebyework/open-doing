"use client";

import { displayName } from "@open-doing/types";
import { useTranslations } from "next-intl";
import { Fragment, useState } from "react";

import { CARD_SHELL } from "@/components/ui/card";
import { UserAvatar } from "@/components/ui/UserAvatar";
import { formatTaskTimestamp } from "@/lib/date-display";

import { codeStatus, type CodeStatus } from "../code-status";
import type { AdminCodeRow } from "../service";

/** 用量进度条填充色（原型 .progress.is-error / .is-warning；正常用品牌紫）。 */
const PROGRESS_COLOR: Record<CodeStatus, string> = {
  normal: "var(--primary)",
  exhausted: "var(--error)",
  low: "var(--warning)",
};

/** 表头单元格样式（原型 .table th：12px 大写字距加宽、淡色）。 */
const TH_CLASS =
  "border-b border-[var(--border-default)] px-3 pb-3 text-left text-[12px] font-semibold uppercase tracking-[0.04em] text-[var(--ink-400)]";

/** 主行单元格样式（原型 .table td：12px 内边距、行间分隔线）。 */
const TD_CLASS =
  "border-b border-[var(--border-default)] px-3 py-3 align-middle";

/** 用量百分比：与概览卡同口径（clamp 0–100，maxUses 为 0 视为满额）。 */
function usagePercent(maxUses: number, usedCount: number): number {
  if (maxUses <= 0) return 100;

  return Math.min(100, Math.max(0, (usedCount / maxUses) * 100));
}

/** 绝对时刻 → Asia/Shanghai 归属日历日（YYYY-MM-DD，与全站日期口径一致）。 */
function displayDate(value: string): string {
  return formatTaskTimestamp(value).slice(0, 10);
}

/**
 * 注册码列表（client：行内展开使用者）。
 *
 * 对照 `admin-registration-codes.html`：表头为注册码 / 用量 / 已用 / 限额 /
 * 创建时间 / 使用者；「使用者」列是可展开按钮（aria-expanded + aria-controls），
 * 展开行列出凭码注册的用户（头像 + 昵称 + uid + 注册时间）。无使用者时
 * 展示「未知」说明。用量进度条颜色复用 `codeStatus` 的阈值。
 */
export function CodesTable({ codes }: { codes: AdminCodeRow[] }) {
  const t = useTranslations("admin");
  const tCommon = useTranslations("common");
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  return (
    <section className={`mt-6 min-w-0 overflow-x-auto ${CARD_SHELL} px-4 py-4 min-[861px]:px-5`}>
      <table className="w-full min-w-[720px] border-collapse text-left text-[13.5px]">
        <thead>
          <tr>
            <th className={TH_CLASS}>{t("colCode")}</th>
            <th className={TH_CLASS}>{t("colUsage")}</th>
            <th className={`${TH_CLASS} whitespace-nowrap`}>{t("colUsed")}</th>
            <th className={`${TH_CLASS} whitespace-nowrap`}>{t("colCreatedAt")}</th>
            <th className={TH_CLASS}>{t("colUsedBy")}</th>
          </tr>
        </thead>
        <tbody className="[&_tr:last-child_td]:border-b-0">
          {codes.map((code, index) => {
            const status = codeStatus(code.maxUses, code.usedCount);
            const percent = usagePercent(code.maxUses, code.usedCount);
            const rowId = `code-users-${index}`;
            const isOpen = Boolean(expanded[code.code]);

            return (
              <Fragment key={code.code}>
                <tr className="transition-colors hover:bg-[var(--muted)]">
                  <td className={TD_CLASS}>
                    <code className="font-mono text-[13px] font-semibold tracking-[0.02em] text-[var(--ink-900)]">
                      {code.code}
                    </code>
                  </td>
                  <td className={TD_CLASS}>
                    <div className="flex min-w-[180px] items-center gap-3">
                      <div
                        role="progressbar"
                        aria-label={tCommon("progress", { percent: Math.round(percent) })}
                        aria-valuemin={0}
                        aria-valuemax={100}
                        aria-valuenow={Math.round(percent)}
                        className="h-[6px] flex-1 overflow-hidden rounded-full bg-[var(--surface-inset)]"
                      >
                        <div
                          className="h-full rounded-full"
                          style={{
                            width: `${percent}%`,
                            background: PROGRESS_COLOR[status],
                          }}
                        />
                      </div>
                      <span className="whitespace-nowrap text-[12px] text-[var(--muted-foreground)] [font-variant-numeric:tabular-nums]">
                        {Math.round(percent)}%
                      </span>
                    </div>
                  </td>
                  <td className={`${TD_CLASS} whitespace-nowrap [font-variant-numeric:tabular-nums]`}>
                    {code.usedCount} / {code.maxUses}
                  </td>
                  <td className={`${TD_CLASS} whitespace-nowrap text-[var(--ink-500)] [font-variant-numeric:tabular-nums]`}>
                    {displayDate(code.createdAt)}
                  </td>
                  <td className={TD_CLASS}>
                    <button
                      type="button"
                      data-testid={`code-users-toggle-${code.code}`}
                      aria-expanded={isOpen}
                      aria-controls={rowId}
                      onClick={() =>
                        setExpanded((prev) => ({
                          ...prev,
                          [code.code]: !prev[code.code],
                        }))
                      }
                      className="rounded-[var(--radius-6)] px-2 py-1 text-[13px] font-semibold text-[var(--primary)] transition-colors hover:bg-[var(--primary-bg)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)]"
                    >
                      {t("usedByCount", { count: code.usedBy.length })}
                    </button>
                  </td>
                </tr>
                <tr
                  id={rowId}
                  hidden={!isOpen}
                  className={isOpen ? undefined : "hidden"}
                >
                  <td colSpan={5} className="bg-[var(--muted)] px-3 pb-3 pt-0">
                    <div className="flex flex-col rounded-[var(--radius-8)] border border-[var(--border-default)] bg-white px-3 py-2">
                      {code.usedBy.length === 0 ? (
                        <p className="px-1 py-3 text-[12.5px] text-[var(--ink-400)]">
                          {t("usedByUnknown")}
                        </p>
                      ) : (
                        code.usedBy.map((user, userIndex) => {
                          const name = displayName(user);

                          return (
                            <div
                              key={user.id}
                              className={`flex items-center gap-2 px-1 py-2 ${
                                userIndex > 0
                                  ? "border-t border-[var(--border-default)]"
                                  : ""
                              }`}
                            >
                              <UserAvatar userId={user.id} name={name} size={24} />
                              <span className="flex min-w-0 items-center gap-2">
                                <span className="truncate text-[13.5px] font-semibold text-[var(--ink-900)]">
                                  {name}
                                </span>
                                <span className="truncate font-mono text-[11px] text-[var(--ink-400)]">
                                  {user.uid}
                                </span>
                              </span>
                              <span className="ml-auto whitespace-nowrap text-[12px] text-[var(--ink-400)]">
                                {t("registeredAt", { date: displayDate(user.createdAt) })}
                              </span>
                            </div>
                          );
                        })
                      )}
                    </div>
                  </td>
                </tr>
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}
