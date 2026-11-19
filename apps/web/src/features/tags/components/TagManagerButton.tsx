"use client";

import { PaletteIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";

import { Button } from "@/components/ui/shadcn/button";

import type { TagManagerDialogProps, TagSpace } from "./TagManagerDialog";
import { TagManagerDialog } from "./TagManagerDialog";

/** TagManagerButton 入参：空间 + RSC 注入的标签池 + 管理权限。 */
export interface TagManagerButtonProps {
  space: TagSpace;
  initialTags: TagManagerDialogProps["initialTags"];
  /** 团队空间仅 owner/admin 渲染入口（spec §6.2）；个人空间恒 true。 */
  canManage: boolean;
}

/**
 * 标签管理入口：项目列表页头按钮，点击打开 TagManagerDialog。
 * `canManage=false` 时不渲染（入口级权限，弹层自身不再重复校验 UI 分支）。
 */
export function TagManagerButton({ space, initialTags, canManage }: TagManagerButtonProps) {
  const t = useTranslations("tags");
  const [open, setOpen] = useState(false);

  if (!canManage) return null;

  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)} data-testid="tags-manage-button">
        <PaletteIcon className="size-4" aria-hidden />
        {t("manageTags")}
      </Button>
      <TagManagerDialog
        open={open}
        onOpenChange={setOpen}
        space={space}
        initialTags={initialTags}
        canManage={canManage}
      />
    </>
  );
}
