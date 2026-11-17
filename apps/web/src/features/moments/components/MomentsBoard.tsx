"use client";

import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { ConfirmModal } from "@/components/ui/ConfirmModal";
import { EmptyState } from "@/components/ui/EmptyState";

import { deleteMomentAction, toggleMomentPinnedAction } from "../actions";
import type { MomentView } from "../service";
import { MomentCard } from "./MomentCard";
import { MomentFormModal } from "./MomentFormModal";

/** MomentsBoard 入参：RSC 取好的全量列表（service 已按置顶 / 方向排序）。 */
export interface MomentsBoardProps {
  /** 初始列表；`router.refresh()` 后以新 props 为准。 */
  initialMoments: MomentView[];
  /** 今天（Asia/Shanghai，`YYYY-MM-DD`），由 RSC 传入以保证口径一致。 */
  today: string;
}

/** Server Action 失败时取第一条可展示文案（兜底文案由调用方按语言传入）。 */
function firstError(errors: Record<string, string>, fallback: string): string {
  return errors.form ?? Object.values(errors)[0] ?? fallback;
}

/**
 * 个人空间「时刻」模块页的卡片墙与交互层。
 *
 * 列表状态采用「渲染期同步 props → state」模式：action 成功后
 * `router.refresh()` 让 RSC 重新取数，新 props 到达时重置本地列表，
 * 保证排序始终由服务端决定（置顶优先 → 临近在前）。
 *
 * 本组件持有编辑弹窗、删除确认与置顶动作；新建入口在页头的
 * `NewMomentButton` 内（独立对话框状态，对齐 `NewTaskButton` 拆分模式）。
 *
 * 弹窗开关用独立布尔量（`editOpen` / `deleteOpen`），目标对象在退出保持
 * 窗口内保持不变：Radix 内容在 `open` 翻 false 后仍挂载 OD_MS.modalOut，
 * 若在成功分支清空目标，退场中的弹窗会闪成空标题 / 新建标题。目标只在
 * 下次打开时覆盖。
 */
export function MomentsBoard({ initialMoments }: MomentsBoardProps) {
  const t = useTranslations("moments");
  const tCommon = useTranslations("common");
  const tErrors = useTranslations("errors");
  const router = useRouter();

  const [synced, setSynced] = useState(initialMoments);
  const [moments, setMoments] = useState(initialMoments);
  const [editOpen, setEditOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<MomentView | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<MomentView | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [pinningId, setPinningId] = useState<string | null>(null);

  // props 变化（router.refresh 后）即同步为最新服务端排序。
  if (initialMoments !== synced) {
    setSynced(initialMoments);
    setMoments(initialMoments);
  }

  async function togglePinned(moment: MomentView): Promise<void> {
    if (pinningId !== null) return;

    setPinningId(moment.id);
    try {
      const result = await toggleMomentPinnedAction(moment.id, !moment.pinned);

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
      const result = await deleteMomentAction(deleteTarget.id);

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

  function handleEditSaved(): void {
    // 只关 open；editTarget 保持到退场窗口结束，标题 / initial 不变。
    setEditOpen(false);
    router.refresh();
  }

  return (
    <div className="w-full min-w-0">
      {moments.length === 0 ? (
        <div className="mt-6">
          <EmptyState
            title={t("widget.emptyTitle")}
            description={t("widget.emptyBody")}
          />
        </div>
      ) : (
        <div className="mt-6 grid gap-4 [grid-template-columns:repeat(auto-fill,minmax(300px,1fr))]">
          {moments.map((moment) => (
            <MomentCard
              key={moment.id}
              moment={moment}
              onEdit={() => {
                setEditTarget(moment);
                setEditOpen(true);
              }}
              onDelete={() => {
                setDeleteTarget(moment);
                setDeleteOpen(true);
              }}
              onTogglePinned={() => {
                void togglePinned(moment);
              }}
            />
          ))}
        </div>
      )}

      <MomentFormModal
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
        okButtonProps={{ "data-testid": "moment-delete-confirm" }}
        onConfirm={() => {
          void confirmDelete();
        }}
        onCancel={() => setDeleteOpen(false)}
      />
    </div>
  );
}
