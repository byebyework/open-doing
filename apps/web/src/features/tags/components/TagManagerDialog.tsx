"use client";

import { CheckIcon, Loader2Icon, PencilIcon, PlusIcon, Trash2Icon, XIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { toast } from "sonner";

import type { TagColor, TagWithUsage } from "@open-doing/types";
import { TAG_COLORS } from "@open-doing/types";

import { ConfirmModal } from "@/components/ui/ConfirmModal";
import { CharCounter } from "@/components/ui/CharCounter";
import { Button } from "@/components/ui/shadcn/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/shadcn/dialog";
import { Input } from "@/components/ui/shadcn/input";

import { TAG_NAME_MAX_LENGTH } from "../constants";
import { createTagAction, deleteTagAction, updateTagAction } from "../actions";
import { tagColorStyle } from "./tag-colors";
import { TagPill } from "./TagPill";

/** 空间定位：团队空间带 teamId，个人空间缺省（action 取会话用户）。 */
export type TagSpace = { kind: "team"; teamId: string } | { kind: "personal" };

/** TagManagerDialog 入参。 */
export interface TagManagerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  space: TagSpace;
  /** RSC 注入的当前空间标签池（含使用计数）。 */
  initialTags: TagWithUsage[];
  /** 团队空间仅 owner/admin 可管理；个人空间恒 true。 */
  canManage: boolean;
}

/** action 入参的空间字段。 */
function spaceInput(space: TagSpace): { teamId?: string } {
  return space.kind === "team" ? { teamId: space.teamId } : {};
}

/** 预设色板圆点单选（无取色器，spec §6.6）。 */
function ColorDots({
  value,
  onChange,
  testPrefix,
}: {
  value: TagColor;
  onChange: (color: TagColor) => void;
  testPrefix: string;
}) {
  const t = useTranslations("tags");

  return (
    <div className="flex items-center gap-1.5" role="radiogroup" aria-label={t("tagColorLabel")}>
      {TAG_COLORS.map((color) => {
        const style = tagColorStyle(color);
        const active = color === value;
        return (
          <button
            key={color}
            type="button"
            role="radio"
            aria-checked={active}
            data-testid={`${testPrefix}-${color}`}
            data-active={active ? "true" : undefined}
            onClick={() => onChange(color)}
            className="relative flex size-6 items-center justify-center rounded-full transition-transform hover:scale-110"
            style={{ backgroundColor: style.backgroundColor }}
          >
            <span
              aria-hidden
              className="size-3 rounded-full"
              style={{ backgroundColor: style.color }}
            />
            {active ? (
              <CheckIcon className="absolute size-3.5" style={{ color: style.color }} aria-hidden />
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

/**
 * 标签管理弹窗：列表（pill + 使用计数 + 改名/换色/删除）+ 顶部新建行。
 *
 * 同 create-code-dialog 的幂等约定：提交 / 删除处理按 `!open || loading`
 * 防退出保持窗口双发；删除走 ConfirmModal（确认不自动关闭，成功分支才收）。
 * 成功后本地列表即时更新 + `router.refresh()` 拉取 RSC 最新数据；
 * 失败保持弹窗并把 field 错误留在输入框下方。
 */
export function TagManagerDialog({
  open,
  onOpenChange,
  space,
  initialTags,
  canManage,
}: TagManagerDialogProps) {
  const t = useTranslations("tags");
  const router = useRouter();

  // sync props -> state during render：RSC refresh 带来新数据时重置本地列表。
  const [syncedTags, setSyncedTags] = useState(initialTags);
  const [tags, setTags] = useState(initialTags);
  if (initialTags !== syncedTags) {
    setSyncedTags(initialTags);
    setTags(initialTags);
  }

  // 新建行状态
  const [name, setName] = useState("");
  const [color, setColor] = useState<TagColor>("purple");
  const [nameError, setNameError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  // 行内编辑状态（同一时间只编辑一行）
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editColor, setEditColor] = useState<TagColor>("purple");
  const [editError, setEditError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // 删除确认状态
  const [pendingDelete, setPendingDelete] = useState<TagWithUsage | null>(null);
  const [deleting, setDeleting] = useState(false);

  function closeDialog(): void {
    if (creating || deleting || saving) return;
    setEditingId(null);
    setNameError(null);
    setEditError(null);
    onOpenChange(false);
  }

  function resetCreate(): void {
    setName("");
    setColor("purple");
    setNameError(null);
  }

  async function onCreate(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!open || creating) return;
    if (!name.trim()) {
      setNameError(t("nameRequired"));
      return;
    }

    setCreating(true);
    setNameError(null);
    try {
      const result = await createTagAction({
        ...spaceInput(space),
        name,
        color,
      });
      if (!result.ok) {
        setNameError(result.errors.name ?? result.errors.form ?? null);
        return;
      }
      setTags((prev) => [...prev, { ...result.data, usageCount: 0 }]);
      resetCreate();
      toast.success(t("tagCreated"));
      router.refresh();
    } finally {
      setCreating(false);
    }
  }

  function startEdit(tag: TagWithUsage): void {
    setEditingId(tag.id);
    setEditName(tag.name);
    setEditColor(tag.color);
    setEditError(null);
  }

  function cancelEdit(): void {
    setEditingId(null);
    setEditError(null);
  }

  async function onSaveEdit(tagId: string): Promise<void> {
    if (!open || saving) return;
    setSaving(true);
    setEditError(null);
    try {
      const result = await updateTagAction({
        ...spaceInput(space),
        tagId,
        name: editName,
        color: editColor,
      });
      if (!result.ok) {
        setEditError(result.errors.name ?? result.errors.form ?? null);
        return;
      }
      setTags((prev) =>
        prev.map((tag) => (tag.id === tagId ? { ...tag, name: result.data.name, color: result.data.color } : tag)),
      );
      setEditingId(null);
      toast.success(t("tagSaved"));
      router.refresh();
    } finally {
      setSaving(false);
    }
  }

  async function onDelete(): Promise<void> {
    if (!open || !pendingDelete || deleting) return;
    setDeleting(true);
    try {
      const result = await deleteTagAction({ ...spaceInput(space), tagId: pendingDelete.id });
      if (!result.ok) {
        toast.error(result.errors.form ?? t("tagNotFound"));
        return;
      }
      setTags((prev) => prev.filter((tag) => tag.id !== pendingDelete.id));
      setPendingDelete(null);
      toast.success(t("tagDeleted"));
      router.refresh();
    } finally {
      setDeleting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => (!next ? closeDialog() : onOpenChange(true))}>
      <DialogContent className="max-w-md" data-testid="tag-manager">
        <DialogHeader>
          <DialogTitle>{t("manageTags")}</DialogTitle>
        </DialogHeader>

        {canManage ? (
          <form onSubmit={onCreate} className="rounded-lg border border-[var(--line-200)] p-3">
            <div className="flex items-center gap-2">
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={t("tagNamePlaceholder")}
                maxLength={TAG_NAME_MAX_LENGTH}
                data-testid="tag-name-input"
                aria-invalid={nameError ? true : undefined}
              />
              <Button type="submit" size="sm" disabled={creating} data-testid="tag-create-submit">
                {creating ? <Loader2Icon className="size-4 animate-spin" aria-hidden /> : <PlusIcon className="size-4" aria-hidden />}
                {t("createTag")}
              </Button>
            </div>
            <div className="mt-2 flex items-center justify-between gap-2">
              <ColorDots value={color} onChange={setColor} testPrefix="tag-color" />
              <CharCounter value={name} max={TAG_NAME_MAX_LENGTH} />
            </div>
            {nameError ? (
              <p className="mt-1 text-[12px] text-[var(--error)]" data-testid="tag-name-error" role="alert">
                {nameError}
              </p>
            ) : null}
          </form>
        ) : null}

        <div className="max-h-72 overflow-y-auto">
          {tags.length === 0 ? (
            <p className="py-6 text-center text-[13px] text-[var(--muted-foreground)]">{t("emptyPool")}</p>
          ) : (
            <ul className="divide-y divide-[var(--line-200)]" data-testid="tag-list">
              {tags.map((tag) => (
                <li key={tag.id} className="flex items-center gap-2 py-2" data-testid="tag-row">
                  {editingId === tag.id ? (
                    <div className="w-full">
                      <Input
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                        maxLength={TAG_NAME_MAX_LENGTH}
                        aria-invalid={editError ? true : undefined}
                        data-testid={`tag-edit-input-${tag.id}`}
                      />
                      <div className="mt-2 flex items-center justify-between gap-2">
                        <ColorDots value={editColor} onChange={setEditColor} testPrefix={`tag-edit-color-${tag.id}`} />
                        <div className="flex items-center gap-1">
                          <Button
                            type="button"
                            size="sm"
                            onClick={() => onSaveEdit(tag.id)}
                            disabled={saving}
                            data-testid={`tag-edit-save-${tag.id}`}
                          >
                            {saving ? <Loader2Icon className="size-4 animate-spin" aria-hidden /> : <CheckIcon className="size-4" aria-hidden />}
                          </Button>
                          <Button type="button" variant="ghost" size="sm" onClick={cancelEdit} data-testid={`tag-edit-cancel-${tag.id}`}>
                            <XIcon className="size-4" aria-hidden />
                          </Button>
                        </div>
                      </div>
                      {editError ? (
                        <p className="mt-1 text-[12px] text-[var(--error)]" role="alert">
                          {editError}
                        </p>
                      ) : null}
                    </div>
                  ) : (
                    <>
                      <TagPill name={tag.name} color={tag.color} />
                      <span className="text-[12px] text-[var(--muted-foreground)]">
                        {t("usageCount", { count: tag.usageCount })}
                      </span>
                      {canManage ? (
                        <span className="ml-auto flex items-center gap-0.5">
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => startEdit(tag)}
                            aria-label={t("editTag")}
                            data-testid={`tag-edit-${tag.id}`}
                          >
                            <PencilIcon className="size-3.5" aria-hidden />
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => setPendingDelete(tag)}
                            aria-label={t("deleteTag")}
                            data-testid={`tag-delete-${tag.id}`}
                          >
                            <Trash2Icon className="size-3.5 text-[var(--error)]" aria-hidden />
                          </Button>
                        </span>
                      ) : null}
                    </>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>

        <ConfirmModal
          open={pendingDelete !== null}
          title={t("deleteTag")}
          content={t("deleteTagConfirm")}
          danger
          loading={deleting}
          okButtonProps={{ "data-testid": "tag-delete-confirm" }}
          onConfirm={onDelete}
          onCancel={() => {
            if (!deleting) setPendingDelete(null);
          }}
        />
      </DialogContent>
    </Dialog>
  );
}
