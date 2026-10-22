"use client";

import { Progress } from "antd";

/** ProgressBar 入参。 */
export interface ProgressBarProps {
  /** 进度值，范围 0 ~ 1（组件内部 ×100 转为百分比）。 */
  value: number;
}

/**
 * 任务/项目进度条。
 *
 * 入参为 0 ~ 1 的小数，内部换算为 antd Progress 的百分比；
 * 超出范围的输入会被钳制到 0 ~ 100。
 */
export function ProgressBar({ value }: ProgressBarProps) {
  const percent = Math.min(100, Math.max(0, value * 100));

  return (
    <Progress
      percent={percent}
      showInfo={false}
      size={{ height: 6 }}
      strokeColor="#7d2ae8"
      railColor="#e8eaed"
      aria-label={`进度 ${Math.round(percent)}%`}
    />
  );
}
