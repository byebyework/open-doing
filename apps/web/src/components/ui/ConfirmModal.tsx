"use client";

import { Loader2Icon } from "lucide-react";
import type { ComponentProps, ReactNode } from "react";
import { useTranslations } from "next-intl";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/shadcn/alert-dialog";
import { buttonVariants } from "@/components/ui/shadcn/button";

/** ConfirmModal 入参。 */
export interface ConfirmModalProps {
  /** 是否显示。 */
  open: boolean;
  /** 标题。 */
  title: string;
  /** 正文内容（字符串或任意节点）。 */
  content: ReactNode;
  /** 确认按钮文案，默认「确认」。 */
  confirmText?: string;
  /** 危险操作：确认按钮使用错误色。 */
  danger?: boolean;
  /** 确认按钮加载态（异步提交中）。 */
  loading?: boolean;
  /** 透传给确认按钮的附加 props（e2e data-testid 等）。 */
  okButtonProps?: ComponentProps<"button"> & { "data-testid"?: string };
  /** 点击确认。 */
  onConfirm: () => void;
  /** 点击取消或关闭。 */
  onCancel: () => void;
}

/**
 * 二次确认弹窗（删除任务、移除成员等）。
 *
 * 统一封装 shadcn AlertDialog 的确认/取消语义；确认按钮可切换危险样式与加载态。
 * 确认点击不自动关闭（preventDefault）——关闭责任在消费方 success 分支置
 * open=false；失败时弹窗保持、输入不丢，loading 态可见（spinner + 禁用）。
 * 取消/Esc/遮罩（非 loading 时）统一走 onCancel；loading 期间三者全被阻止
 * （antd confirmLoading 同语义：提交中不允许侧门关闭丢输入）。
 */
export function ConfirmModal({
  open,
  title,
  content,
  confirmText,
  danger = false,
  loading = false,
  okButtonProps,
  onConfirm,
  onCancel,
}: ConfirmModalProps) {
  const t = useTranslations("common");
  const okText = confirmText ?? t("confirm");

  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onCancel();
      }}
    >
      {/* Radix 默认 role="alertdialog";e2e 契约按通用 dialog 查询,显式覆盖(frozen 断言不改)。 */}
      <AlertDialogContent
        role="dialog"
        onEscapeKeyDown={(event) => {
          if (loading) event.preventDefault();
        }}
        onInteractOutside={(event) => {
          if (loading) event.preventDefault();
        }}
      >
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div>{content}</div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={loading}>{t("cancel")}</AlertDialogCancel>
          <AlertDialogAction
            className={buttonVariants({ variant: danger ? "destructive" : "default" })}
            disabled={loading}
            onClick={(event) => {
              // Radix Action 默认点击即关弹窗;preventDefault 后关闭责任移到
              // 消费方 success 分支,失败时弹窗保持、输入不丢,loading 态可见。
              event.preventDefault();
              onConfirm();
            }}
            {...okButtonProps}
          >
            {loading ? <Loader2Icon className="animate-spin" aria-hidden="true" /> : null}
            {okText}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
