"use client";

import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import type { ReactNode } from "react";

export interface CollapseRevealProps {
  /** 是否展开内容。 */
  open: boolean;
  children: ReactNode;
}

/**
 * 卡片折叠体动效（右侧卡统一口径，参数取自 Progress 卡）：
 * height 0→auto 0.22s + opacity 0.16s，收起对称略快；
 * reduced-motion 用户退化为瞬时/纯淡出。
 * 折叠标题行的 chevron 旋转由各卡片自身的 transition-transform 负责。
 */
export function CollapseReveal({ open, children }: CollapseRevealProps) {
  const prefersReducedMotion = useReducedMotion();
  return (
    <AnimatePresence initial={false}>
      {open ? (
        <motion.div
          initial={prefersReducedMotion ? false : { height: 0, opacity: 0 }}
          animate={{ height: "auto", opacity: 1 }}
          exit={prefersReducedMotion ? { opacity: 0 } : { height: 0, opacity: 0 }}
          transition={
            prefersReducedMotion
              ? { duration: 0 }
              : { height: { duration: 0.22, ease: [0.25, 0.1, 0.25, 1] }, opacity: { duration: 0.16 } }
          }
          className="overflow-hidden"
        >
          {children}
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
