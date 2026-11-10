"use client";

import Image from "next/image";
import { useTranslations } from "next-intl";
import { motion } from "motion/react";

import { cn } from "@/lib/utils";

import analysisShot from "../assets/analysis.png";
import calendarShot from "../assets/calendar.png";
import dashboardShot from "../assets/dashboard.png";
import kanbanShot from "../assets/kanban.png";
import { fadeUp, staggerContainer } from "../motion-presets";

/**
 * 功能区四个模块：顺序与 mockup 一致（dashboard / kanban / calendar /
 * analysis）。偶数行图片在右、奇数行图片在左；移动端一律「文在上、图在下」。
 */
const FEATURE_ITEMS = [
  { key: "dashboard", shot: dashboardShot },
  { key: "kanban", shot: kanbanShot },
  { key: "calendar", shot: calendarShot },
  { key: "analysis", shot: analysisShot },
] as const;

/**
 * 功能区（#features）。
 *
 * 区块引言 + 4 行图文交替。每行进入视口时（`once: true`）由
 * `staggerContainer` 让文案与截图错峰淡入上移；截图是整页采集的高图，
 * 统一裁进 16:10 固定框并顶对齐（`object-cover object-top`），既防 CLS
 * 又保证每行构图一致。系统「减弱动态效果」由根布局的
 * `MotionConfig reducedMotion="user"` 统一静止。
 */
export function FeaturesSection() {
  const t = useTranslations("landing");

  return (
    <section
      id="features"
      data-testid="landing-features"
      className="scroll-mt-16 bg-[var(--surface-white)]"
    >
      <div className="mx-auto max-w-[1120px] px-4 pb-4 pt-14 text-center sm:px-6 lg:pt-20">
        <span className="text-[11px] font-bold tracking-[0.18em] text-[var(--purple-600)]">
          {t("features.label")}
        </span>
        <h2 className="mt-2 text-[clamp(1.5rem,2.6vw,2rem)] font-extrabold tracking-[-0.02em] text-[var(--ink-900)]">
          {t("features.title")}
        </h2>
      </div>

      <div>
        {FEATURE_ITEMS.map((item, index) => {
          // mockup：dashboard / calendar 图在右，kanban / analysis 图在左。
          const imageRight = index % 2 === 0;

          return (
            <div
              key={item.key}
              className={cn(
                index % 2 === 1 && "bg-[var(--surface-subtle)]",
              )}
            >
              <motion.div
                data-feature={item.key}
                variants={staggerContainer}
                initial="hidden"
                whileInView="visible"
                viewport={{ once: true, margin: "-80px" }}
                className="mx-auto grid max-w-[1120px] items-center gap-8 px-4 py-10 sm:px-6 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.3fr)] lg:gap-12 lg:py-14"
              >
                {/* 文案 */}
                <motion.div
                  variants={fadeUp}
                  className={cn(
                    "max-w-[480px]",
                    imageRight ? "lg:order-1" : "lg:order-2",
                  )}
                >
                  <span
                    data-testid="feature-tag"
                    className="inline-flex items-center rounded-[var(--radius-pill)] bg-[var(--purple-08)] px-2.5 py-1 text-[12px] font-semibold text-[var(--purple-600)]"
                  >
                    {t(`features.items.${item.key}.tag`)}
                  </span>
                  <h3 className="mt-3 text-[clamp(1.15rem,1.9vw,1.45rem)] font-extrabold tracking-[-0.02em] text-[var(--ink-900)]">
                    {t(`features.items.${item.key}.title`)}
                  </h3>
                  <p
                    data-testid="feature-body"
                    className="mt-3 text-[15px] leading-[1.7] text-[var(--ink-500)]"
                  >
                    {t(`features.items.${item.key}.body`)}
                  </p>
                </motion.div>

                {/* 截图：固定 16:10 框 + 顶部对齐裁切 */}
                <motion.div
                  variants={fadeUp}
                  className={cn(imageRight ? "lg:order-2" : "lg:order-1")}
                >
                  <div className="overflow-hidden rounded-[var(--radius-btn)] border border-[var(--border-default)] bg-[var(--surface-white)] shadow-[var(--shadow-card-hover)]">
                    <div className="relative aspect-[16/10]">
                      <Image
                        src={item.shot}
                        alt={t(`features.items.${item.key}.alt`)}
                        fill
                        sizes="(min-width: 1024px) 620px, 100vw"
                        className="object-cover object-top"
                      />
                    </div>
                  </div>
                </motion.div>
              </motion.div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
