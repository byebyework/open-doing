"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { motion } from "motion/react";

import { Button } from "@/components/ui/shadcn/button";

import { fadeUp } from "../motion-presets";

/**
 * 顶部高光光晕：品牌渐变块上的一团白色柔光，颜色由 `--surface-white`
 * 经 color-mix 取 alpha（不落字面色值）。元素比容器更宽，平移时始终
 * 覆盖整块，不会在边缘露出空隙。
 */
const GLOW_STYLE = {
  backgroundImage:
    "radial-gradient(340px 170px at 20% 0%, color-mix(in srgb, var(--surface-white) 25%, transparent), transparent 70%)",
} as const;

/**
 * 底部 CTA（品牌渐变大色块）。
 *
 * 白底紫字主按钮 → /register，描边白字次按钮 → /login，命中高度 ≥44px；
 * hover 由 `whileHover` 轻微放大。装饰性光晕是绝对定位的 aria-hidden
 * motion 元素，以 9s 周期 `x` 往复（`repeatType: "mirror"`）——不用 CSS
 * keyframes；系统「减弱动态效果」下由 `MotionConfig` 自动静止。
 */
export function CtaSection() {
  const t = useTranslations("landing");

  return (
    <section
      data-testid="landing-cta"
      className="bg-[var(--surface-white)] px-4 pb-14 pt-2 sm:px-6"
    >
      <motion.div
        variants={fadeUp}
        initial="hidden"
        whileInView="visible"
        viewport={{ once: true, margin: "-80px" }}
        className="relative mx-auto max-w-[1120px] overflow-hidden rounded-[var(--radius-panel)] px-6 py-12 text-center sm:py-14"
        style={{ backgroundImage: "var(--brand-gradient)" }}
      >
        <motion.div
          aria-hidden="true"
          style={GLOW_STYLE}
          animate={{ x: ["-6%", "6%"] }}
          transition={{
            duration: 9,
            repeat: Infinity,
            repeatType: "mirror",
            ease: "easeInOut",
          }}
          className="pointer-events-none absolute inset-y-0 -left-[20%] w-[140%]"
        />

        <h2 className="relative text-[clamp(1.35rem,2.4vw,1.75rem)] font-extrabold tracking-[-0.02em] text-(--surface-white)">
          {t("cta.title")}
        </h2>
        <p className="relative mt-3 text-[14px] leading-[1.6] text-(--surface-white)/80">
          {t("cta.subtitle")}
        </p>

        <div className="relative mt-7 flex flex-wrap items-center justify-center gap-3">
          <motion.div whileHover={{ scale: 1.03 }}>
            <Button
              asChild
              variant="outline"
              size="lg"
              className="h-11 border-0 bg-(--surface-white) px-6 text-[14px] font-semibold text-[var(--purple-700)] shadow-[var(--shadow-card-hover)] hover:bg-(--surface-white) hover:text-[var(--purple-700)]"
            >
              <Link href="/register" data-testid="landing-register-cta">
                {t("cta.start")}
              </Link>
            </Button>
          </motion.div>
          <motion.div whileHover={{ scale: 1.03 }}>
            <Button
              asChild
              variant="outline"
              size="lg"
              className="h-11 border-(--surface-white)/80 bg-transparent px-6 text-[14px] font-semibold text-(--surface-white) shadow-none hover:bg-(--surface-white)/10 hover:text-(--surface-white)"
            >
              <Link href="/login">{t("cta.login")}</Link>
            </Button>
          </motion.div>
        </div>
      </motion.div>
    </section>
  );
}
