"use client";

import { CheckIcon, FolderIcon, Loader2Icon, RefreshCwIcon, SquareCheckIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useState } from "react";

import type { Tag, TagColor, TagType, TagWithUsage } from "@open-doing/types";
import { TAG_COLORS } from "@open-doing/types";

import { Button } from "@/components/ui/shadcn/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/shadcn/dialog";
import { Input } from "@/components/ui/shadcn/input";
import { Label } from "@/components/ui/shadcn/label";
import { Textarea } from "@/components/ui/shadcn/textarea";

import { TAG_DESCRIPTION_MAX_LENGTH, TAG_NAME_MAX_LENGTH } from "../constants";
import { createTagAction, updateTagAction } from "../actions";
import { tagColorStyle } from "./tag-colors";
import { TagPill } from "./TagPill";


/** 空间定位：团队空间带 teamId，个人空间缺省（action 取会话用户）。 */
export type TagSpace = { kind: "team"; teamId: string } | { kind: "personal" };

/** TagFormDialog 入参：`editing` 传空即创建态；类型创建后不可改。删除走模块表格。 */
export interface TagFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  space: TagSpace;
  /** 编辑态的标签（null = 创建）。 */
  editing: TagWithUsage | null;
  /** 保存成功后回调（父组件刷新本地列表 + RSC）。 */
  onSaved: (tag: Tag, mode: "create" | "edit") => void;
}

/** 预设色板单选 + 随机按钮（创建态全部启用；沿用白勾选中语汇）。 */
function ColorDots({
  value,
  onChange,
  withRandom,
  disabled,
}: {
  value: TagColor;
  onChange: (color: TagColor) => void;
  withRandom: boolean;
  disabled?: boolean;
}) {
  const tTags = useTranslations("tags");
  const tLabels = useTranslations("labels");

  return (
    <div className="flex items-center gap-2" role="radiogroup" aria-label={tTags("tagColorLabel")}>

      {withRandom ? (
        <button
          type="button"
          onClick={() => onChange(TAG_COLORS[Math.floor(Math.random() * TAG_COLORS.length)]!)}
          className="flex size-7 items-center justify-center rounded-full bg-[var(--purple-600)] text-white transition-transform hover:scale-105 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-focus-ring)]"
          aria-label={tLabels("randomColorAria")}
          disabled={disabled}
        >
          <RefreshCwIcon className="size-3.5" aria-hidden />
        </button>
      ) : null}
      {TAG_COLORS.map((color) => {
        const style = tagColorStyle(color);
        const active = color === value;
        return (
          <button
            key={color}
            type="button"
            role="radio"
            aria-checked={active}
            data-testid={`tagform-color-${color}`}
            onClick={() => onChange(color)}
            disabled={disabled}
            className="relative flex size-7 items-center justify-center rounded-full transition-transform hover:scale-105 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-focus-ring)] disabled:opacity-50"
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

/**
 * 标签新建 / 编辑弹窗（创建与编辑同构）：
 * 实时 pill 预览、名称（必填限长 20）、类型二选一卡片（编辑态禁用——
 * 类型创建后不可改）、可选描述（限长 100）、6 预设色板 + 随机按钮。
 * 幂等约定同 create-code-dialog：`!open || pending` 防退出保持双发。
 */
export function TagFormDialog({
  open,
  onOpenChange,
  space,
  editing,
  onSaved,
}: TagFormDialogProps) {
  const t = useTranslations("labels");
  const tTags = useTranslations("tags");
  const tCommon = useTranslations("common");
  const router = useRouter();

  const isEdit = editing !== null;

  const [name, setName] = useState(editing?.name ?? "");
  const [type, setType] = useState<TagType>(editing?.type ?? "task");
  const [description, setDescription] = useState(editing?.description ?? "");
  const [color, setColor] = useState<TagColor>(editing?.color ?? "purple");
  const [pending, setPending] = useState(false);
  const [fieldError, setFieldError] = useState<string | null>(null);

  function closeDialog(): void {
    if (pending) return;
    onOpenChange(false);
  }

  async function onSubmit(): Promise<void> {
    if (!open || pending) return;
    if (!name.trim()) {
      setFieldError(tTags("nameRequired"));
      return;
    }

    setPending(true);
    setFieldError(null);
    try {
      const result = isEdit
        ? await updateTagAction({ ...(space.kind === "team" ? { teamId: space.teamId } : {}), tagId: editing!.id, name, color, description: description.trim() || null })
        : await createTagAction({ ...(space.kind === "team" ? { teamId: space.teamId } : {}), name, color, type, description: description.trim() || null });
      if (!result.ok) {
        setFieldError(result.errors.name ?? result.errors.description ?? result.errors.form ?? null);
        return;
      }
      onSaved(result.data, isEdit ? "edit" : "create");
      router.refresh();
      onOpenChange(false);
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => (!next ? closeDialog() : onOpenChange(true))}>
      <DialogContent className="max-w-lg" data-testid="tag-form-dialog">
        <DialogHeader>
          <DialogTitle>{isEdit ? t("editTitle") : t("createTitle")}</DialogTitle>
        </DialogHeader>

        {/* 实时预览区 */}
        <div className="flex min-h-14 items-center justify-center rounded-lg border border-[var(--line-200)] bg-[var(--surface-cool)] py-3">
          <TagPill name={name.trim() || t("previewFallback")} color={color} size="md" />
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="tag-form-name">{t("nameLabel")} *</Label>
          <Input
            id="tag-form-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={TAG_NAME_MAX_LENGTH}
            placeholder={tTags("tagNamePlaceholder")}
            autoFocus
            aria-invalid={fieldError ? true : undefined}
            data-testid="tagform-name-input"
          />
        </div>

        <div className="flex flex-col gap-2">
          <Label>{t("typeLabel")}</Label>
          <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label={t("typeLabel")}>
            {(
              [
                { value: "project" as TagType, label: t("typeProject"), Icon: FolderIcon },
                { value: "task" as TagType, label: t("typeTask"), Icon: SquareCheckIcon },
              ]
            ).map(({ value, label, Icon }) => {
              const active = type === value;
              return (
                <button
                  key={value}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  disabled={isEdit}
                  onClick={() => setType(value)}
                  data-testid={`tagform-type-${value}`}
                  className={`flex items-center justify-center gap-2 rounded-lg border px-3 py-2.5 text-[13.5px] font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--color-focus-ring)] disabled:cursor-not-allowed disabled:opacity-60 ${
                    active
                      ? "border-[var(--purple-600)] bg-[var(--purple-08)] text-[var(--purple-600)]"
                      : "border-[var(--line-200)] text-[var(--ink-900)] hover:border-[var(--purple-30)]"
                  }`}
                >
                  <Icon className="size-4" aria-hidden />
                  {label}
                </button>
              );
            })}
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="tag-form-description">{t("descriptionLabel")}</Label>
          <Textarea
            id="tag-form-description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            maxLength={TAG_DESCRIPTION_MAX_LENGTH}
            rows={2}
            placeholder={t("descriptionPlaceholder")}
            data-testid="tagform-description-input"
          />
        </div>

        <div className="flex flex-col gap-2">
          <Label>{tTags("tagColorLabel")}</Label>
          <ColorDots
            value={color}
            onChange={setColor}
            withRandom={!isEdit}
            disabled={pending}
          />
        </div>

        {fieldError ? (
          <p className="text-[12px] text-[var(--error)]" role="alert" data-testid="tagform-error">
            {fieldError}
          </p>
        ) : null}

        <DialogFooter>
          <Button type="button" variant="outline" disabled={pending} onClick={closeDialog}>
            {tCommon("cancel")}
          </Button>
          <Button
            type="button"
            onClick={onSubmit}
            disabled={pending}
            data-testid="tagform-submit"
          >
            {pending ? <Loader2Icon className="size-4 animate-spin" aria-hidden /> : null}
            {isEdit ? tCommon("save") : t("newTag")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

