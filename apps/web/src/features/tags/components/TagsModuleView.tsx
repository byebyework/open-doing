"use client";

import { FolderIcon, PencilIcon, PlusIcon, SearchIcon, SquareCheckIcon, Trash2Icon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import type { TagType, TagWithUsage } from "@open-doing/types";

import { ConfirmModal } from "@/components/ui/ConfirmModal";
import { Button } from "@/components/ui/shadcn/button";
import { Input } from "@/components/ui/shadcn/input";

import { deleteTagAction } from "../actions";
import { TagFormDialog } from "./TagFormDialog";
import { TagPill } from "./TagPill";
import type { TagSpace } from "./TagManagerDialog";

type TabFilter = "all" | TagType;

/** TagsModuleView 入参：RSC 注入标签池 + 管理权限。 */
export interface TagsModuleViewProps {
  space: TagSpace;
  initialTags: TagWithUsage[];
  canManage: boolean;
}

/**
 * 标签模块视图（原型「标签管理」页）：
 * tabs（全部 / 项目标签 / 任务标签，计数恒为全池口径）+ 搜索（名称或描述）
 * + 表格（预览 / 类型徽标 / 描述 / 关联数量 / 最近更新 / 操作）。
 * 管理动作仅 canManage 渲染；删除走动态确认（使用数明示）。
 */
export function TagsModuleView({ space, initialTags, canManage }: TagsModuleViewProps) {
  const t = useTranslations("labels");
  const tTags = useTranslations("tags");
  const router = useRouter();

  const [syncedTags, setSyncedTags] = useState(initialTags);
  const [tags, setTags] = useState(initialTags);
  if (initialTags !== syncedTags) {
    setSyncedTags(initialTags);
    setTags(initialTags);
  }

  const [tab, setTab] = useState<TabFilter>("all");
  const [filter, setFilter] = useState("");
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<TagWithUsage | null>(null);
  const [pendingDelete, setPendingDelete] = useState<TagWithUsage | null>(null);
  const [deleting, setDeleting] = useState(false);

  const counts = useMemo(
    () => ({
      all: tags.length,
      project: tags.filter((tag) => tag.type === "project").length,
      task: tags.filter((tag) => tag.type === "task").length,
    }),
    [tags],
  );

  const visibleTags = useMemo(() => {
    const keyword = filter.trim().toLowerCase();
    const byTab = tab === "all" ? tags : tags.filter((tag) => tag.type === tab);
    if (!keyword) return byTab;
    return byTab.filter(
      (tag) =>
        tag.name.toLowerCase().includes(keyword) ||
        (tag.description ?? "").toLowerCase().includes(keyword),
    );
  }, [tags, tab, filter]);

  const TABS: { key: TabFilter; label: string; count: number }[] = [
    { key: "all", label: t("tabAll"), count: counts.all },
    { key: "project", label: t("tabProject"), count: counts.project },
    { key: "task", label: t("tabTask"), count: counts.task },
  ];

  async function onDelete(): Promise<void> {
    if (!pendingDelete || deleting) return;
    setDeleting(true);
    try {
      const result = await deleteTagAction({
        ...(space.kind === "team" ? { teamId: space.teamId } : {}),
        tagId: pendingDelete.id,
      });
      if (!result.ok) {
        toast.error(result.errors.form ?? tTags("tagNotFound"));
        return;
      }
      setTags((prev) => prev.filter((tag) => tag.id !== pendingDelete.id));
      setPendingDelete(null);
      toast.success(tTags("tagDeleted"));
      router.refresh();
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div data-testid="tags-module-page">
      {/* 工具行：tabs + 搜索（照原型两张卡片行） */}
      <div className="rounded-xl border border-[var(--border-default)] bg-white p-4 shadow-[var(--shadow-rest)]">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-1" role="tablist" aria-label={t("title")}>
            {TABS.map(({ key, label, count }) => (
              <button
                key={key}
                type="button"
                role="tab"
                aria-selected={tab === key}
                onClick={() => setTab(key)}
                data-testid={`tags-tab-${key}`}
                className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[13.5px] font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--color-focus-ring)] ${
                  tab === key
                    ? "bg-[var(--purple-08)] text-[var(--purple-600)]"
                    : "text-[var(--muted-foreground)] hover:bg-[var(--purple-08)]"
                }`}
              >
                {label}
                <span className="rounded-full bg-[var(--purple-100)] px-1.5 text-[11px] tabular-nums text-[var(--purple-600)]">
                  {count}
                </span>
              </button>
            ))}
          </div>
          <div className="relative ml-auto min-w-[220px]">
            <SearchIcon
              aria-hidden
              className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-[var(--ink-400)]"
            />
            <Input
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder={t("searchPlaceholder")}
              className="pl-8"
              data-testid="tags-search-input"
            />
          </div>
          {canManage ? (
            <Button
              type="button"
              onClick={() => {
                setEditing(null);
                setFormOpen(true);
              }}
              data-testid="tags-new-button"
            >
              <PlusIcon className="size-4" aria-hidden />
              {t("newTag")}
            </Button>
          ) : null}
        </div>
      </div>

      {/* 表格 */}
      <div className="mt-4 overflow-hidden rounded-xl border border-[var(--border-default)] bg-white shadow-[var(--shadow-rest)]">
        <table className="w-full border-collapse text-left text-[13.5px]">
          <thead>
            <tr>
              {[
                t("colPreview"),
                t("colType"),
                t("colDescription"),
                t("colRelated"),
                t("colUpdated"),
                t("colOps"),
              ].map((label) => (
                <th
                  key={label}
                  className="border-b border-[var(--border-default)] px-4 py-3 text-[12px] font-semibold uppercase tracking-[0.04em] text-[var(--ink-400)]"
                >
                  {label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="[&_tr:last-child_td]:border-b-0">
            {visibleTags.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-[13px] text-[var(--muted-foreground)]">
                  {tTags("emptyPool")}
                </td>
              </tr>
            ) : (
              visibleTags.map((tag) => (
                <tr key={tag.id} className="transition-colors hover:bg-[#f4f5f7]" data-testid="tags-module-row">
                  <td className="border-b border-[var(--border-default)] px-4 py-3">
                    <TagPill name={tag.name} color={tag.color} />
                  </td>
                  <td className="border-b border-[var(--border-default)] px-4 py-3">
                    <span className="inline-flex items-center gap-1.5 rounded-md border border-[var(--line-200)] px-2 py-1 text-[12px] text-[var(--ink-900)]">
                      {tag.type === "project" ? (
                        <FolderIcon className="size-3.5 text-[var(--purple-600)]" aria-hidden />
                      ) : (
                        <SquareCheckIcon className="size-3.5 text-[var(--purple-600)]" aria-hidden />
                      )}
                      {tag.type === "project" ? t("typeProject") : t("typeTask")}
                    </span>
                  </td>
                  <td className="max-w-[240px] truncate border-b border-[var(--border-default)] px-4 py-3 text-[var(--muted-foreground)]">
                    {tag.description ?? "—"}
                  </td>
                  <td className="border-b border-[var(--border-default)] px-4 py-3 tabular-nums">
                    {tag.type === "project"
                      ? t("relatedProjects", { count: tag.usageCount })
                      : t("relatedTasks", { count: tag.usageCount })}
                  </td>
                  <td className="border-b border-[var(--border-default)] px-4 py-3 tabular-nums text-[var(--muted-foreground)]">
                    {tag.updatedAt.slice(0, 10)}
                  </td>
                  <td className="border-b border-[var(--border-default)] px-4 py-3">
                    {canManage ? (
                      <span className="flex items-center gap-0.5">
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          aria-label={tTags("editTag")}
                          className="text-[var(--ink-400)] hover:text-[var(--ink-900)]"
                          onClick={() => {
                            setEditing(tag);
                            setFormOpen(true);
                          }}
                          data-testid={`tags-edit-${tag.id}`}
                        >
                          <PencilIcon className="size-3.5" aria-hidden />
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          aria-label={tTags("deleteTag")}
                          className="text-[var(--ink-400)] hover:text-[var(--error)]"
                          onClick={() => setPendingDelete(tag)}
                          data-testid={`tags-delete-${tag.id}`}
                        >
                          <Trash2Icon className="size-3.5" aria-hidden />
                        </Button>
                      </span>
                    ) : (
                      <span className="text-[var(--ink-400)]">—</span>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <TagFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        space={space}
        editing={editing}
        onSaved={(tag, mode) => {
          if (mode === "create") {
            setTags((prev) => [...prev, { ...tag, usageCount: 0 }]);
          } else {
            setTags((prev) =>
              prev.map((item) => (item.id === tag.id ? { ...item, ...tag, usageCount: item.usageCount } : item)),
            );
          }
          setEditing(null);
        }}
      />

      <ConfirmModal
        open={pendingDelete !== null}
        title={tTags("deleteTag")}
        content={
          pendingDelete && pendingDelete.usageCount > 0
            ? tTags("deleteTagConfirmUsed", { count: pendingDelete.usageCount })
            : tTags("deleteTagConfirmUnused")
        }
        danger
        loading={deleting}
        okButtonProps={{ "data-testid": "tags-delete-confirm" }}
        onConfirm={onDelete}
        onCancel={() => {
          if (!deleting) setPendingDelete(null);
        }}
      />

    </div>
  );
}
