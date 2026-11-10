"use client";

import { User, Users, type LucideIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { motion } from "motion/react";

import { cn } from "@/lib/utils";

import { fadeUp, staggerContainer } from "../motion-presets";

/** 团队卡渐变浅底：品牌紫 8% → 青色 6%，全部取 tokens.css 变量。 */
const TEAM_CARD_STYLE = {
  backgroundImage:
    "linear-gradient(135deg, var(--purple-08), color-mix(in srgb, var(--cyan-500) 6%, transparent))",
} as const;

interface AudienceCardProps {
  icon: LucideIcon;
  title: string;
  body: string;
  tone: "individual" | "team";
}

/**
 * 单张场景卡：图标徽章 + 标题 + 正文。
 *
 * individual 为白底、蓝色 `User` 徽章；team 为紫青渐变浅底、紫色 `Users`
 * 徽章（配色对齐 mockup：蓝 #3ea6ff / 紫 #7d2ae8，分别走 `--accent-sky*`
 * 与 `--purple-*` token）。卡片直接作为错峰淡入的 motion 子元素。
 */
function AudienceCard({ icon: Icon, title, body, tone }: AudienceCardProps) {
  const isTeam = tone === "team";

  return (
    <motion.div
      variants={fadeUp}
      style={isTeam ? TEAM_CARD_STYLE : undefined}
      className={cn(
        "rounded-[var(--radius-card)] border p-6 sm:p-7",
        isTeam
          ? "border-[var(--purple-30)]"
          : "border-[var(--border-default)] bg-[var(--surface-white)]",
      )}
    >
      <div className="flex items-center gap-2.5">
        <span
          className={cn(
            "inline-flex size-8 items-center justify-center rounded-[var(--radius-btn)]",
            isTeam
              ? "bg-[var(--purple-08)] text-[var(--purple-600)]"
              : "bg-[var(--accent-sky-bg)] text-[var(--accent-sky)]",
          )}
        >
          <Icon aria-hidden="true" className="size-4" />
        </span>
        <h3
          className={cn(
            "text-[15px] font-bold",
            isTeam ? "text-[var(--purple-600)]" : "text-[var(--ink-900)]",
          )}
        >
          {title}
        </h3>
      </div>
      <p className="mt-3 text-[14px] leading-[1.7] text-[var(--ink-500)]">
        {body}
      </p>
    </motion.div>
  );
}

/**
 * 双场景区（#audiences）：独立工作者（白底）与小团队（渐变浅底）两张卡。
 * 区块标题与卡片以 80ms 错峰淡入上移，进入视口只触发一次。
 */
export function AudiencesSection() {
  const t = useTranslations("landing");

  return (
    <section
      id="audiences"
      data-testid="landing-audiences"
      className="scroll-mt-16 bg-[var(--surface-white)]"
    >
      <motion.div
        variants={staggerContainer}
        initial="hidden"
        whileInView="visible"
        viewport={{ once: true, margin: "-80px" }}
        className="mx-auto max-w-[1120px] px-4 py-14 sm:px-6 lg:py-20"
      >
        <motion.div variants={fadeUp} className="text-center">
          <span className="text-[11px] font-bold tracking-[0.18em] text-[var(--purple-600)]">
            {t("audiences.label")}
          </span>
          <h2 className="mt-2 text-[clamp(1.5rem,2.6vw,2rem)] font-extrabold tracking-[-0.02em] text-[var(--ink-900)]">
            {t("audiences.title")}
          </h2>
        </motion.div>

        <div className="mt-8 grid gap-4 md:grid-cols-2">
          <AudienceCard
            icon={User}
            tone="individual"
            title={t("audiences.individual.title")}
            body={t("audiences.individual.body")}
          />
          <AudienceCard
            icon={Users}
            tone="team"
            title={t("audiences.team.title")}
            body={t("audiences.team.body")}
          />
        </div>
      </motion.div>
    </section>
  );
}
