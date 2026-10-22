"use client";

import { Modal } from "antd";
import type { ReactNode } from "react";

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
  /** 点击确认。 */
  onConfirm: () => void;
  /** 点击取消或关闭。 */
  onCancel: () => void;
}

/**
 * 二次确认弹窗（删除任务、移除成员等）。
 *
 * 统一封装 antd Modal 的确认/取消语义；确认按钮可切换危险样式与加载态。
 */
export function ConfirmModal({
  open,
  title,
  content,
  confirmText = "确认",
  danger = false,
  loading = false,
  onConfirm,
  onCancel,
}: ConfirmModalProps) {
  return (
    <Modal
      open={open}
      title={title}
      okText={confirmText}
      cancelText="取消"
      confirmLoading={loading}
      okButtonProps={{ danger }}
      onOk={onConfirm}
      onCancel={onCancel}
    >
      {content}
    </Modal>
  );
}
