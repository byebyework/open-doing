"use client";

import { ArrowUpDownIcon, CheckIcon, Loader2Icon, MoreHorizontalIcon, PencilIcon, PlusIcon, SearchIcon, XIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useMemo, useState, type FormEvent } from "react";
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/shadcn/dropdown-menu";
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

/** 预设色板圆点单选（无取色器，spec §6.6；选中 = 色块内白勾）。 */
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
    <div className="flex items-center gap-2" role="radiogroup" aria-label={t("tagColorLabel")}>
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
            className="relative flex size-7 items-center justify-center rounded-full transition-transform hover:scale-105 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-focus-ring)]"
          >
            <span
              aria-hidden
              className="size-5 rounded-full shadow-[inset_0_0_0_1px_rgba(0,0,0,0.08)]"
              style={{ backgroundColor: style.color }}
            />
            {active ? (
              <CheckIcon
                aria-hidden
                className="absolute size-3.5 text-white drop-shadow-[0_1px_1px_rgba(0,0,0,0.25)]"
              />
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

/** 行内编辑器（创建 / 编辑同构）：输入框 + 色板 + 确认/取消。 */
function TagEditorRow({
  initialName,
  initialColor,
  submitLabel,
  pending,
  error,
  nameInputId,
  placeholder,
  onSubmit,
  onCancel,
}: {
  initialName: string;
  initialColor: TagColor;
  submitLabel: string;
  pending: boolean;
  error: string | null;
  /** testid 后缀（name-input / edit-input-<id>）。 */
  nameInputId: string;
  placeholder?: string;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(initialName);
  const [color, setColor] = useState<TagColor>(initialColor);

  return (
    <form
      onSubmit={(event) => {
        // 编辑器行自持状态；提交时经 data 属性带上当前输入。
        const form = event.currentTarget;
        form.dataset.tagName = name;
        form.dataset.tagColor = color;
        onSubmit(event);
      }}
      className="rounded-lg border border-[var(--purple-30)] bg-[var(--purple-08)] p-3"
    >
      <Input
        value={name}
        onChange={(e) => setName(e.target.value)}
        maxLength={TAG_NAME_MAX_LENGTH}
        placeholder={placeholder}
        autoFocus
        aria-invalid={error ? true : undefined}
        data-testid={`tag-${nameInputId}`}
      />
      <div className="mt-2 flex items-center justify-between gap-2">
        <ColorDots value={color} onChange={setColor} testPrefix={`tag-color-${nameInputId}`} />
        <div className="flex items-center gap-2">
          <CharCounter value={name} max={TAG_NAME_MAX_LENGTH} />
          <Button type="button" variant="ghost" size="sm" onClick={onCancel} disabled={pending} data-testid={`tag-cancel-${nameInputId}`}>
            <XIcon className="size-4" aria-hidden />
          </Button>
          <Button type="submit" size="sm" disabled={pending} data-testid={`tag-save-${nameInputId}`}>
            {pending ? <Loader2Icon className="size-4 animate-spin" aria-hidden /> : <CheckIcon className="size-4" aria-hidden />}
            {submitLabel}
          </Button>
        </div>
      </div>
      {error ? (
        <p className="mt-1 text-[12px] text-[var(--error)]" role="alert" data-testid={`tag-error-${nameInputId}`}>
          {error}
        </p>
      ) : null}
    </form>
  );
}

/**
 * 标签管理弹窗（Hallmark 审计定稿形态）：
 * - 创建区默认收起：头部「＋ 新建标签」展开列表顶部编辑行，与编辑态同构；
 *   标签池为空时自动展开（empty state 即引导）。
 * - 列表头部过滤 + 使用量/创建时间排序（客户端，≤50 条）。
 * - 行操作分级：铅笔（高频，低对比 hover 提亮）+「⋯」菜单收纳删除（红色
 *   文字项 → ConfirmModal 二次确认，动态文案明示影响任务数）。
 * - 幂等约定同 create-code-dialog：提交 / 删除按 `!open || pending` 防双发。
 */
export function TagManagerDialog({
  open,
  onOpenChange,
  space,
  initialTags,
  canManage,
}: TagManagerDialogProps) {
  const t = useTranslations("tags");
  const tCommon = useTranslations("common");
  const router = useRouter();

  // sync props -> state during render：RSC refresh 带来新数据时重置本地列表。
  const [syncedTags, setSyncedTags] = useState(initialTags);
  const [tags, setTags] = useState(initialTags);
  if (initialTags !== syncedTags) {
    setSyncedTags(initialTags);
    setTags(initialTags);
  }

  // 创建态（收起 / 展开）
  const [createOpen, setCreateOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [nameError, setNameError] = useState<string | null>(null);

  // 行内编辑状态（同一时间只编辑一行）
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editError, setEditError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // 过滤 + 排序
  const [filter, setFilter] = useState("");
  const [sortByUsage, setSortByUsage] = useState(false);

  // 删除确认状态
  const [pendingDelete, setPendingDelete] = useState<TagWithUsage | null>(null);
  const [deleting, setDeleting] = useState(false);

  const visibleTags = useMemo(() => {
    const keyword = filter.trim().toLowerCase();
    const filtered = keyword
      ? tags.filter((tag) => tag.name.toLowerCase().includes(keyword))
      : tags;
    if (!sortByUsage) return filtered;
    return [...filtered].sort(
      (a, b) => b.usageCount - a.usageCount || a.createdAt.localeCompare(b.createdAt),
    );
  }, [tags, filter, sortByUsage]);

  function closeDialog(): void {
    if (creating || deleting || saving) return;
    setEditingId(null);
    setCreateOpen(false);
    setNameError(null);
    setEditError(null);
    onOpenChange(false);
  }

  async function onCreate(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!open || creating) return;
    const name = event.currentTarget.dataset.tagName ?? "";
    const color = (event.currentTarget.dataset.tagColor ?? "purple") as TagColor;
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
      setCreateOpen(false);
      toast.success(t("tagCreated"));
      router.refresh();
    } finally {
      setCreating(false);
    }
  }

  function startEdit(tag: TagWithUsage): void {
    setCreateOpen(false);
    setEditingId(tag.id);
    setEditError(null);
  }

  async function onSaveEdit(event: FormEvent<HTMLFormElement>, tagId: string): Promise<void> {
    event.preventDefault();
    if (!open || saving) return;
    const name = event.currentTarget.dataset.tagName ?? "";
    const color = (event.currentTarget.dataset.tagColor ?? "purple") as TagColor;
    setSaving(true);
    setEditError(null);
    try {
      const result = await updateTagAction({
        ...spaceInput(space),
        tagId,
        name,
        color,
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
        <DialogHeader className="flex-row items-center justify-between space-y-0">
          <DialogTitle>{t("manageTags")}</DialogTitle>
          {canManage ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                setEditingId(null);
                setCreateOpen(true);
              }}
              data-testid="tag-new-toggle"
            >
              <PlusIcon className="size-4" aria-hidden />
              {t("createTag")}
            </Button>
          ) : null}
        </DialogHeader>

        {tags.length > 0 ? (
          <div className="flex items-center gap-2">
            <div className="relative min-w-0 flex-1">
              <SearchIcon
                aria-hidden
                className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-[var(--ink-400)]"
              />
              <Input
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                placeholder={t("searchPlaceholder")}
                className="pl-8"
                data-testid="tag-search-input"
              />
            </div>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setSortByUsage((prev) => !prev)}
              className="shrink-0 text-[12px] text-[var(--muted-foreground)]"
              aria-pressed={sortByUsage}
              data-testid="tag-sort-toggle"
              title={t("sortToggle")}
            >
              <ArrowUpDownIcon className="size-3.5" aria-hidden />
              {sortByUsage ? t("sortByUsage") : t("sortByCreated")}
            </Button>
          </div>
        ) : null}

        <div className="max-h-72 overflow-y-auto">
          {createOpen || (canManage && tags.length === 0) ? (
            <div className="mb-3">
              <TagEditorRow
                initialName=""
                initialColor="purple"
                submitLabel={t("createTag")}
                pending={creating}
                error={nameError}
                nameInputId="name-input"
                placeholder={t("tagNamePlaceholder")}
                onSubmit={onCreate}
                onCancel={() => {
                  if (!creating) setCreateOpen(false);
                }}
              />
            </div>
          ) : null}

          {tags.length === 0 ? (
            <p className="py-6 text-center text-[13px] text-[var(--muted-foreground)]">{t("emptyPool")}</p>
          ) : visibleTags.length === 0 ? (
            <p className="py-6 text-center text-[13px] text-[var(--muted-foreground)]">{t("noSearchResult")}</p>
          ) : (
            <ul className="divide-y divide-[var(--line-200)]" data-testid="tag-list">
              {visibleTags.map((tag) => (
                <li key={tag.id} className="flex items-center gap-2 py-2" data-testid="tag-row">
                  {editingId === tag.id ? (
                    <div className="w-full">
                      <TagEditorRow
                        initialName={tag.name}
                        initialColor={tag.color}
                        submitLabel={tCommon("save")}
                        pending={saving}
                        error={editError}
                        nameInputId={`edit-input-${tag.id}`}
                        placeholder={t("tagNamePlaceholder")}
                        onSubmit={(event) => onSaveEdit(event, tag.id)}
                        onCancel={() => {
                          if (!saving) setEditingId(null);
                        }}
                      />
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
                            className="text-[var(--ink-400)] hover:text-[var(--ink-900)]"
                            data-testid={`tag-edit-${tag.id}`}
                          >
                            <PencilIcon className="size-3.5" aria-hidden />
                          </Button>
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                aria-label={t("moreActions")}
                                className="text-[var(--ink-400)] hover:text-[var(--ink-900)]"
                                data-testid={`tag-menu-${tag.id}`}
                              >
                                <MoreHorizontalIcon className="size-3.5" aria-hidden />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem
                                variant="destructive"
                                onClick={() => setPendingDelete(tag)}
                                data-testid={`tag-delete-${tag.id}`}
                              >
                                {t("deleteTag")}
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
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
          content={
            pendingDelete && pendingDelete.usageCount > 0
              ? t("deleteTagConfirmUsed", { count: pendingDelete.usageCount })
              : t("deleteTagConfirmUnused")
          }
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
