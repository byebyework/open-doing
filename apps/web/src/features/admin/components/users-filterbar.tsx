"use client";

import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState, useTransition } from "react";

import { Input } from "@/components/ui/shadcn/input";

/** 状态筛选值：与 URL `?status=` 一一对应（非法值由页面归一为 all）。 */
export type UserStatusFilter = "all" | "active" | "disabled";

/** 搜索防抖窗口（毫秒）。 */
const SEARCH_DEBOUNCE_MS = 300;

/** 筛选条入参：RSC 从 URL 解析后的当前值。 */
export interface UsersFilterBarProps {
  /** 当前搜索关键词（页面已 trim）。 */
  query: string;
  /** 当前状态筛选。 */
  status: UserStatusFilter;
}

/** 三个筛选选项（顺序与原型一致：全部 / 正常 / 已禁用）。 */
const STATUS_OPTIONS: {
  value: UserStatusFilter;
  labelKey: "filterAll" | "filterActive" | "filterDisabled";
}[] = [
  { value: "all", labelKey: "filterAll" },
  { value: "active", labelKey: "filterActive" },
  { value: "disabled", labelKey: "filterDisabled" },
];

/** 分段按钮基础样式（原型 `.toggle-group > button`：6px 圆角、13px 半粗）。 */
const TOGGLE_BASE =
  "cursor-pointer rounded-[var(--radius-6)] px-3.5 py-[5px] text-[13px] font-semibold transition-[background-color,color,box-shadow] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)]";

/** 激活态：浅色胶囊 + 静止阴影（原型 `.toggle-group > button.active`）。 */
const TOGGLE_ACTIVE =
  "bg-[var(--accent)] text-[var(--accent-foreground)] shadow-[var(--shadow-rest)]";

/** 未激活态：次要文字色，hover 提升到主文字色。 */
const TOGGLE_IDLE =
  "text-[var(--muted-foreground)] hover:text-[var(--ink-900)]";

/**
 * 由两个筛选参数拼出列表页地址。
 *
 * 空关键词与 all 状态都不写进 URL（保持地址干净），
 * 其余参数原样由 `URLSearchParams` 编码。
 */
function buildHref(query: string, status: UserStatusFilter): string {
  const params = new URLSearchParams();
  if (query) params.set("q", query);
  if (status !== "all") params.set("status", status);

  const search = params.toString();
  return search ? `/admin/users?${search}` : "/admin/users";
}

/**
 * 用户列表筛选条（client：搜索框 + 状态分段按钮）。
 *
 * 筛选是纯路由状态：搜索输入停止 300ms 后 `router.replace` 写回 `?q=`，
 * 状态按钮点击立即写回 `?status=`；RSC 页面按新 URL 重新取数/过滤。
 * 渲染期同步 props → state 时只回填「不是本端刚提交的值」，避免慢网络下
 * RSC 回包把用户继续输入的新字符冲掉。`pending` 标记在筛选条上用
 * `aria-busy` 暴露。
 */
export function UsersFilterBar({
  query: initialQuery,
  status: initialStatus,
}: UsersFilterBarProps) {
  const t = useTranslations("admin");
  const router = useRouter();
  const [query, setQuery] = useState(initialQuery);
  const [status, setStatus] = useState<UserStatusFilter>(initialStatus);
  const [syncedQuery, setSyncedQuery] = useState(initialQuery);
  const [syncedStatus, setSyncedStatus] = useState(initialStatus);
  // 本端最近一次提交的值（state 而非 ref：渲染期同步需读取，且 ref 读取
  // 在渲染中被 lint 禁止）。URL 回包与它相同说明是「自己的回声」，不回填输入框。
  const [committedQuery, setCommittedQuery] = useState(initialQuery);
  const [committedStatus, setCommittedStatus] =
    useState<UserStatusFilter>(initialStatus);
  const [pending, startTransition] = useTransition();

  // 渲染期同步 props → state（AGENTS 约定），见组件注释中的回包竞争说明。
  if (initialQuery !== syncedQuery) {
    setSyncedQuery(initialQuery);
    if (initialQuery !== committedQuery) setQuery(initialQuery);
  }
  if (initialStatus !== syncedStatus) {
    setSyncedStatus(initialStatus);
    if (initialStatus !== committedStatus) setStatus(initialStatus);
  }

  const navigate = useCallback(
    (nextQuery: string, nextStatus: UserStatusFilter) => {
      const trimmed = nextQuery.trim();
      setCommittedQuery(trimmed);
      setCommittedStatus(nextStatus);
      const href = buildHref(trimmed, nextStatus);

      startTransition(() => {
        router.replace(href, { scroll: false });
      });
    },
    [router, startTransition],
  );

  // 搜索防抖：输入停止 300ms 后写回 URL；status 变化会取消尚未触发的搜索提交。
  useEffect(() => {
    if (query.trim() === committedQuery) return;

    const timer = window.setTimeout(() => {
      navigate(query, status);
    }, SEARCH_DEBOUNCE_MS);

    return () => window.clearTimeout(timer);
  }, [committedQuery, navigate, query, status]);

  /** 点击分段按钮：立即提交（同时带上下方已输入但尚未防抖的关键词）。 */
  function handleStatusChange(nextStatus: UserStatusFilter) {
    if (nextStatus === status) return;
    setStatus(nextStatus);
    navigate(query, nextStatus);
  }

  return (
    <div
      className="mb-4 mt-6 flex flex-wrap items-center gap-2"
      aria-busy={pending}
    >
      <Input
        type="search"
        value={query}
        aria-label={t("usersSearchPlaceholder")}
        placeholder={t("usersSearchPlaceholder")}
        data-testid="admin-users-search"
        onChange={(event) => setQuery(event.target.value)}
        className="h-9 w-full min-[861px]:w-[280px]"
      />

      <div className="flex-1" />

      <div
        role="group"
        aria-label={t("colStatus")}
        className="inline-flex items-center gap-[2px] rounded-[var(--radius-8)] bg-[var(--surface-inset)] p-[3px]"
      >
        {STATUS_OPTIONS.map((option) => {
          const active = option.value === status;

          return (
            <button
              key={option.value}
              type="button"
              aria-pressed={active}
              data-testid={`admin-users-status-${option.value}`}
              onClick={() => handleStatusChange(option.value)}
              className={`${TOGGLE_BASE} ${active ? TOGGLE_ACTIVE : TOGGLE_IDLE}`}
            >
              {t(option.labelKey)}
            </button>
          );
        })}
      </div>
    </div>
  );
}
