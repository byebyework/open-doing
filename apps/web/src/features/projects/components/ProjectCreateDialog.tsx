"use client";

import type { Tag } from "@open-doing/types";
import { PlusIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/shadcn/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/shadcn/dialog";

import { ProjectForm, type ProjectFormSpace } from "./ProjectForm";

export interface ProjectCreateDialogProps {
  space: ProjectFormSpace;
  /** 项目类型标签池（RSC 注入；空池不渲染标签区）。 */
  projectTagPool: Tag[];
  /** 触发按钮文案（缺省复用 projects.newProjectButton）。 */
  triggerLabel?: string;
  /** 表单 testid 前缀（团队页 "team-project"、个人页 "personal-project"）。 */
  testIdPrefix?: string;
  /** 触发按钮 testid 覆写（沿用既有 e2e 选择器时传）。 */
  triggerTestId?: string;
}

/**
 * 「新建项目」弹窗（对照原型 projects-create-dialog.png）：触发按钮 + Dialog 壳。
 *
 * 壳遵循 overlay exit-hold：open 翻 false 后表单仍挂载 ~200ms，ProjectForm
 * 以 `open` 作幂等闸防双提交；成功分支（toast + 关闭 + refresh）只走一次。
 */
export function ProjectCreateDialog({
  space,
  projectTagPool,
  triggerLabel,
  testIdPrefix = "project",
  triggerTestId,
}: ProjectCreateDialogProps) {
  const t = useTranslations("projects");
  const router = useRouter();
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button
        data-testid={triggerTestId ?? `${testIdPrefix}-create-trigger`}
        onClick={() => setOpen(true)}
      >
        <PlusIcon className="size-4" aria-hidden="true" />
        {triggerLabel ?? t("newProjectButton")}
      </Button>

      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (!next) setOpen(false);
        }}
      >
        <DialogContent
          className="flex h-[min(90dvh,880px)] w-full flex-col gap-3 overflow-y-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden sm:max-w-[900px]"
          data-testid={`${testIdPrefix}-create-dialog`}
        >
          <DialogHeader>
            <DialogTitle>{t("dialogTitleCreate")}</DialogTitle>
          </DialogHeader>

          <ProjectForm
            space={space}
            projectTagPool={projectTagPool}
            onSuccess={() => {
              toast.success(t("projectCreated"));
              setOpen(false);
              router.refresh();
            }}
            onCancel={() => setOpen(false)}
            testIdPrefix={testIdPrefix}
            open={open}
          />
        </DialogContent>
      </Dialog>
    </>
  );
}
