"use client";

/**
 * 落地页首屏动效预设。
 *
 * 缓动曲线统一引用 Task 2 的 `OD_EASE`（`components/ui/overlay-motion`），
 * 本文件只声明 landing 自己的 variants，不重复定义曲线数组。
 *
 * - fadeUp：子元素入场——上移 24px 归位、透明度 0 → 1、decelerate 收敛；
 * - staggerContainer：容器按 80ms 间隔依次触发子元素（设计文档 §7.2
 *   「首屏左列：徽标 chip → H1 → 副文案 → CTA 依次淡入上移」）。
 */

import type { Variants } from "motion/react";

import { OD_EASE } from "@/components/ui/overlay-motion";

/** 单元素淡入上移：y 24 → 0、opacity 0 → 1。 */
export const fadeUp: Variants = {
  hidden: { opacity: 0, y: 24 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.5, ease: OD_EASE.decelerate },
  },
};

/** 容器：子元素以 80ms 间隔依次进场。 */
export const staggerContainer: Variants = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.08 } },
};
