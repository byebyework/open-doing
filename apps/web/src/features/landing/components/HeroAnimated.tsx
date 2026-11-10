"use client";

import Image from "next/image";
import Link from "next/link";
import { Bell, Target } from "lucide-react";
import { useRef } from "react";
import type { Variants } from "motion/react";
import { motion, useReducedMotion, useScroll, useTransform } from "motion/react";

import { Button } from "@/components/ui/shadcn/button";

import calendarShot from "../assets/calendar.png";
import kanbanShot from "../assets/kanban.png";
import { fadeUp, staggerContainer } from "../motion-presets";

/** 首屏文案（RSC 外壳从 `landing.hero` 读取后以可序列化 props 传入）。 */
export interface HeroCopy {
  badge: string;
  titleLine1: string;
  titleLine2: string;
  subtitle: string;
  ctaStart: string;
  ctaLogin: string;
  trust: string;
  reminderCard: string;
}

export interface HeroAnimatedProps {
  copy: HeroCopy;
}

/**
 * 首屏双屏拼贴的入场 variants（仅桌面 lg 使用，移动端静态堆叠）。
 * 日历在后、看板在前：先带额外旋转从偏移位漂移，再 spring 收敛到
 * mockup 规定的 2deg / −2.5deg 静态倾角。缓动走 Task 2 的 OD_EASE。
 */
const calendarEnter: Variants = {
  hidden: { opacity: 0, y: 32, rotate: 5 },
  visible: {
    opacity: 1,
    y: 0,
    rotate: 2,
    transition: { type: "spring", stiffness: 110, damping: 15, delay: 0.15 },
  },
};

const kanbanEnter: Variants = {
  hidden: { opacity: 0, y: -32, rotate: -5.5 },
  visible: {
    opacity: 1,
    y: 0,
    rotate: -2.5,
    transition: { type: "spring", stiffness: 110, damping: 15, delay: 0.3 },
  },
};

/** 提醒卡最后弹入（排在双屏之后）。 */
const reminderEnter: Variants = {
  hidden: { opacity: 0, scale: 0.85 },
  visible: {
    opacity: 1,
    scale: 1,
    transition: { type: "spring", stiffness: 220, damping: 18, delay: 0.6 },
  },
};

/** 品牌渐变文字（135° 紫 → 青，端点取 tokens.css 变量）。 */
const GRADIENT_TEXT_STYLE = {
  backgroundImage:
    "linear-gradient(135deg, var(--purple-600), var(--cyan-500))",
} as const;

/** 首屏氛围光：左上青、右侧紫，均取品牌色 token 的极低透明度。 */
const SECTION_GLOW_STYLE = {
  backgroundImage:
    "radial-gradient(500px 260px at 8% -60px, color-mix(in srgb, var(--cyan-500) 10%, transparent), transparent 70%), radial-gradient(500px 280px at 96% 40%, var(--purple-08), transparent 70%)",
} as const;

/**
 * 首屏（B 方案：左文右双屏拼贴）。
 *
 * 左列按 80ms 间隔逐项淡入上移；右列日历 / 看板错峰弹簧落位、提醒卡
 * 最后弹入并无限上下浮动，整列随页面滚动做 ±24px 视差。全部动效由
 * `motion/react` 承担；根布局的 `MotionConfig reducedMotion="user"` 只停用
 * transform / 位置类动画（旋转、位移、缩放、浮动），透明度淡入在系统
 * 「减弱动态效果」下仍会播放（设计上把 opacity 视为非运动反馈）。滚动视差
 * 不属于 Motion 动画，故这里用 `useReducedMotion()` 显式归零。lg 以下拼贴
 * 改为无旋转的纵向堆叠，因此桌面拼贴单独渲染（`hidden lg:block`），
 * 移动端保持静态。
 */
export function HeroAnimated({ copy }: HeroAnimatedProps) {
  const rootRef = useRef<HTMLElement>(null);
  const { scrollYProgress } = useScroll({
    target: rootRef,
    offset: ["start start", "end start"],
  });
  const parallaxY = useTransform(scrollYProgress, [0, 1], [24, -24]);
  // useScroll/useTransform 产出的 MotionValue 直接驱动 style，MotionConfig 的
  // reducedMotion 只作用于动画，不会停用该风格；这里显式归零以尊重系统设置。
  const reduceMotion = useReducedMotion();

  return (
    <section
      id="hero"
      ref={rootRef}
      data-testid="landing-hero"
      className="relative overflow-hidden bg-[var(--surface-white)]"
      style={SECTION_GLOW_STYLE}
    >
      <div className="mx-auto grid max-w-[1120px] gap-10 px-4 py-14 sm:px-6 lg:grid-cols-[1fr_1.15fr] lg:items-center lg:gap-8 lg:py-20">
        {/* 左列：文案依次淡入上移 */}
        <motion.div
          variants={staggerContainer}
          initial="hidden"
          animate="visible"
          className="max-w-[520px]"
        >
          <motion.span
            variants={fadeUp}
            className="inline-flex items-center gap-1.5 rounded-[var(--radius-pill)] bg-[var(--purple-08)] px-3 py-1.5 text-[13px] font-semibold text-[var(--purple-600)]"
          >
            <Target aria-hidden="true" className="size-3.5" />
            {copy.badge}
          </motion.span>

          <motion.h1
            variants={fadeUp}
            className="mt-4 text-[clamp(2.15rem,4.6vw,3.35rem)] font-extrabold leading-[1.16] tracking-[-0.03em] text-[var(--ink-900)]"
          >
            <span className="block">{copy.titleLine1}</span>
            <span
              className="block bg-clip-text text-transparent"
              style={GRADIENT_TEXT_STYLE}
            >
              {copy.titleLine2}
            </span>
          </motion.h1>

          <motion.p
            variants={fadeUp}
            className="mt-5 max-w-[30rem] text-[15px] leading-[1.7] text-[var(--ink-500)] sm:text-base"
          >
            {copy.subtitle}
          </motion.p>

          <motion.div
            variants={fadeUp}
            className="mt-7 flex flex-wrap items-center gap-3"
          >
            <Button
              asChild
              variant="gradient"
              size="lg"
              className="h-11 px-6 text-[14px] font-semibold"
            >
              <Link href="/register">{copy.ctaStart}</Link>
            </Button>
            <Button
              asChild
              variant="outline"
              size="lg"
              className="h-11 border-[var(--border-default)] bg-[var(--surface-white)] px-6 text-[14px] text-[var(--ink-700)]"
            >
              <Link href="/login">{copy.ctaLogin}</Link>
            </Button>
          </motion.div>

          <motion.p
            variants={fadeUp}
            className="mt-5 text-[12px] leading-[1.6] text-[var(--ink-500)]"
          >
            {copy.trust}
          </motion.p>
        </motion.div>

        {/* 移动端（<lg）：双屏纵向堆叠、无旋转、无动效 */}
        <div className="grid gap-4 lg:hidden">
          <div className="overflow-hidden rounded-[var(--radius-btn)] border border-[var(--border-default)] bg-[var(--surface-white)] shadow-[var(--shadow-card-hover)]">
            <Image
              src={calendarShot}
              alt=""
              sizes="100vw"
              className="h-auto w-full"
            />
          </div>
          <div className="overflow-hidden rounded-[var(--radius-btn)] border border-[var(--border-default)] bg-[var(--surface-white)] shadow-[var(--shadow-modal)]">
            <Image
              src={kanbanShot}
              alt=""
              sizes="100vw"
              className="h-auto w-full"
            />
          </div>
          <div
            data-testid="hero-reminder-mobile"
            className="inline-flex items-center gap-2 self-start rounded-[var(--radius-btn)] border border-[var(--border-default)] bg-[var(--surface-white)] px-3.5 py-2.5 text-[13px] font-medium text-[var(--ink-700)] shadow-[var(--shadow-card-hover)]"
          >
            <Bell
              aria-hidden="true"
              className="size-4 text-[var(--accent-tangerine)]"
            />
            <span>{copy.reminderCard}</span>
          </div>
        </div>

        {/* 桌面（≥lg）：双屏绝对定位拼贴 + 入场漂移 + 滚动视差 */}
        <div className="relative hidden lg:block lg:h-[480px]">
          <motion.div
            style={{ y: reduceMotion ? 0 : parallaxY }}
            className="absolute inset-0"
          >
            <motion.div
              variants={calendarEnter}
              initial="hidden"
              animate="visible"
              className="absolute right-0 top-0 w-[74%] origin-center"
            >
              <div className="overflow-hidden rounded-[var(--radius-btn)] border border-[var(--border-default)] bg-[var(--surface-white)] shadow-[var(--shadow-card-hover)]">
                <Image
                  src={calendarShot}
                  alt=""
                  sizes="(min-width: 1024px) 440px, 100vw"
                  fetchPriority="high"
                  className="h-auto w-full"
                />
              </div>
            </motion.div>

            <motion.div
              variants={kanbanEnter}
              initial="hidden"
              animate="visible"
              className="absolute bottom-0 left-0 w-[72%] origin-center"
            >
              <div className="overflow-hidden rounded-[var(--radius-btn)] border border-[var(--border-default)] bg-[var(--surface-white)] shadow-[var(--shadow-modal)]">
                <Image
                  src={kanbanShot}
                  alt=""
                  sizes="(min-width: 1024px) 430px, 100vw"
                  fetchPriority="high"
                  className="h-auto w-full"
                />
              </div>
            </motion.div>

            <motion.div
              variants={reminderEnter}
              initial="hidden"
              animate="visible"
              className="absolute bottom-10 left-[26%] z-[7]"
            >
              <motion.div
                animate={{ y: [0, -6, 0] }}
                transition={{
                  duration: 2.6,
                  repeat: Infinity,
                  ease: "easeInOut",
                  delay: 0.9,
                }}
              >
                <div
                  data-testid="hero-reminder-desktop"
                  className="inline-flex items-center gap-2 rounded-[var(--radius-btn)] border border-[var(--border-default)] bg-[var(--surface-white)] px-3.5 py-2.5 text-[13px] font-medium text-[var(--ink-700)] shadow-[var(--shadow-card-hover)]"
                >
                  <Bell
                    aria-hidden="true"
                    className="size-4 text-[var(--accent-tangerine)]"
                  />
                  <span>{copy.reminderCard}</span>
                </div>
              </motion.div>
            </motion.div>
          </motion.div>
        </div>
      </div>
    </section>
  );
}
