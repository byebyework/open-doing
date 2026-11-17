"use client";

import { PlusIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/shadcn/button";

import { MomentFormModal } from "./MomentFormModal";

/**
 * 「时刻」模块页页头的新建入口：按钮 + 独立的新建对话框。
 *
 * 对齐 dashboard 的 `NewTaskButton` 拆分模式：RSC 页面渲染 PageHeader 时
 * 传入本组件，对话框状态留在客户端；保存成功后关闭并 `router.refresh()`。
 * 新建态主按钮为「保存并置顶」（payload 恒定 `pinned: true`）。
 */
export function NewMomentButton() {
  const t = useTranslations("moments");
  const router = useRouter();
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button
        variant="gradient"
        data-testid="moments-create-button"
        onClick={() => setOpen(true)}
      >
        <PlusIcon aria-hidden="true" />
        {t("page.create")}
      </Button>

      <MomentFormModal
        open={open}
        onOpenChange={setOpen}
        onSaved={() => {
          setOpen(false);
          router.refresh();
        }}
      />
    </>
  );
}
