"use client";

import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { ConfirmModal } from "@/components/ui/ConfirmModal";
import { EmptyState } from "@/components/ui/EmptyState";
import { PageHeader } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/shadcn/button";

import {
  deleteDayAction,
  toggleDayPinnedAction,
} from "../actions";
import type { ImportantDayView } from "../service";
import { DayCard } from "./DayCard";
import { DayFormModal } from "./DayFormModal";

/** DaysBoard 入参：RSC 取好的全量列表（service 已按置顶 / 方向排序）。 */
export interface DaysBoardProps {
  /** 初始列表；`router.refresh()` 后以新 props 为准。 */
  initialDays: ImportantDayView[];
  /** 今天（Asia/Shanghai，`YYYY-MM-DD`），由 RSC 传入以保证口径一致。 */
  today: string;
}

/** Server Action 失败时取第一条可展示文案（兜底文案由调用方按语言传入）。 */
function firstError(errors: Record<string, string>, fallback: string): string {
  return errors.form ?? Object.values(errors)[0] ?? fallback;
}

/**
 * 个人空间「重要日子」模块页的客户端交互层。
 *
 * 持有卡片墙、新建 / 编辑弹窗、删除确认与置顶动作。列表状态采用
 * 「渲染期同步 props → state」模式：action 成功后 `router.refresh()` 让
 * RSC 重新取数，新 props 到达时重置本地列表，保证排序始终由服务端决定。
 *
 * 删除复用 `ConfirmModal`（确认不自动关闭）：成功分支才关闭并刷新，
 * 失败保持弹窗；`!deleteTarget || deleting` 是 loading / exit-hold 期间的
 * 幂等闸门。
 *
 * 弹窗开关用独立布尔量（`editOpen` / `deleteOpen`），目标对象在 exit-hold
 * 窗口内保持不变：Radix 内容在 `open` 翻 false 后仍挂载 OD_MS.modalOut，
 * 若在成功分支清空目标，退场中的弹窗会闪成空标题 / 新建标题。目标只在
 * 下次打开时覆盖（同 TaskRowActions 的稳定 deleteOpen 模式）。
 */
export function DaysBoard({ initialDays }: DaysBoardProps) {
  const t = useTranslations("days");
  const tCommon = useTranslations("common");
  const tErrors = useTranslations("errors");
  const router = useRouter();

  const [synced, setSynced] = useState(initialDays);
  const [days, setDays] = useState(initialDays);
  const [createOpen, setCreateOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<ImportantDayView | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<ImportantDayView | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [pinningId, setPinningId] = useState<string | null>(null);

  // props 变化（router.refresh 后）即同步为最新服务端排序。
  if (initialDays !== synced) {
    setSynced(initialDays);
    setDays(initialDays);
  }

  async function togglePinned(day: ImportantDayView): Promise<void> {
    if (pinningId !== null) return;

    setPinningId(day.id);
    try {
      const result = await toggleDayPinnedAction(day.id, !day.pinned);

      if (!result.ok) {
        toast.error(firstError(result.errors, tErrors("operationFailed")));
        return;
      }

      router.refresh();
    } catch {
      toast.error(tCommon("networkError"));
    } finally {
      setPinningId(null);
    }
  }

  async function confirmDelete(): Promise<void> {
    if (!deleteTarget || deleting) return;

    setDeleting(true);
    try {
      const result = await deleteDayAction(deleteTarget.id);

      if (!result.ok) {
        toast.error(firstError(result.errors, tErrors("operationFailed")));
        return;
      }

      // 只关 open；deleteTarget 保持到退场窗口结束，标题不闪空。
      setDeleteOpen(false);
      router.refresh();
    } catch {
      toast.error(tCommon("networkError"));
    } finally {
      setDeleting(false);
    }
  }

  function handleCreateSaved(): void {
    setCreateOpen(false);
    router.refresh();
  }

  function handleEditSaved(): void {
    // 只关 open；editTarget 保持到退场窗口结束，标题 / initial 不变。
    setEditOpen(false);
    router.refresh();
  }

  return (
    <div className="mx-auto w-full min-w-0 max-w-[1320px]">
      <PageHeader
        title={t("page.title")}
        subtitle={t("page.subtitle")}
        actions={
          <Button
            data-testid="days-create-button"
            onClick={() => setCreateOpen(true)}
          >
            {t("page.create")}
          </Button>
        }
      />

      {days.length === 0 ? (
        <div className="mt-6">
          <EmptyState
            title={t("widget.emptyTitle")}
            description={t("widget.emptyBody")}
            action={
              <Button onClick={() => setCreateOpen(true)}>
                {t("widget.emptyAction")}
              </Button>
            }
          />
        </div>
      ) : (
        <div className="mt-6 grid gap-4 [grid-template-columns:repeat(auto-fill,minmax(280px,1fr))]">
          {days.map((day) => (
            <DayCard
              key={day.id}
              day={day}
              onEdit={() => {
                setEditTarget(day);
                setEditOpen(true);
              }}
              onDelete={() => {
                setDeleteTarget(day);
                setDeleteOpen(true);
              }}
              onTogglePinned={() => {
                void togglePinned(day);
              }}
            />
          ))}
        </div>
      )}

      <DayFormModal
        open={createOpen}
        onOpenChange={setCreateOpen}
        onSaved={handleCreateSaved}
      />

      <DayFormModal
        open={editOpen}
        onOpenChange={(next) => {
          if (!next) setEditOpen(false);
        }}
        initial={editTarget ?? undefined}
        onSaved={handleEditSaved}
      />

      <ConfirmModal
        open={deleteOpen}
        title={t("deleteConfirmTitle", { title: deleteTarget?.title ?? "" })}
        content={t("deleteConfirmBody")}
        confirmText={t("deleteConfirmAction")}
        danger
        loading={deleting}
        okButtonProps={{ "data-testid": "day-delete-confirm" }}
        onConfirm={() => {
          void confirmDelete();
        }}
        onCancel={() => setDeleteOpen(false)}
      />
    </div>
  );
}
