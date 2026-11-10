"use client";

import { ChevronDownIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { AnimatePresence, motion } from "motion/react";
import { useState, type KeyboardEvent } from "react";

import { OD_EASE } from "../../../components/ui/overlay-motion";
import { fadeUp, staggerContainer } from "../motion-presets";

/** 三条问答与 `landing.faq.items` 的键一一对应（free / solo / install）。 */
const FAQ_KEYS = ["free", "solo", "install"] as const;

type FaqKey = (typeof FAQ_KEYS)[number];

/**
 * FAQ 手风琴（#faq）。
 *
 * 自建 motion 手风琴（不套 vendored Accordion）：每项用原生 `<button>`
 * 承载 `aria-expanded` / `aria-controls`，仅一个问答处于展开态，默认第一项。
 * 点击或键盘 Enter/Space 切换；面板由 `AnimatePresence` 承接进出场，
 * `height: auto` 补间采用 OD_EASE.decelerate 入场、accelerate 退场
 * （与浮层动效同一组曲线）。chevron 随展开态旋转 180°。
 *
 * 系统「减弱动态效果」由根布局的 `MotionConfig reducedMotion="user"`
 * 统一处理：位移/旋转类动画静止，高度补间作为布局展开保留。
 */
export function FaqSection() {
  const t = useTranslations("landing");
  const [openKey, setOpenKey] = useState<FaqKey | null>("free");

  function toggle(key: FaqKey): void {
    setOpenKey((current) => (current === key ? null : key));
  }

  // 原生 button 在浏览器中已自带 Enter/Space 激活；显式处理是为了让键盘
  // 语义可被 jsdom 测试覆盖，同时 preventDefault 避免真实浏览器双触发。
  function handleKeyDown(
    event: KeyboardEvent<HTMLButtonElement>,
    key: FaqKey,
  ): void {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      toggle(key);
    }
  }

  return (
    <section
      id="faq"
      data-testid="landing-faq"
      className="scroll-mt-16 bg-[var(--surface-subtle)]"
    >
      <motion.div
        variants={staggerContainer}
        initial="hidden"
        whileInView="visible"
        viewport={{ once: true, margin: "-80px" }}
        className="mx-auto max-w-[1120px] px-4 py-14 sm:px-6 lg:py-20"
      >
        <motion.div variants={fadeUp} className="text-center">
          <h2 className="text-[clamp(1.5rem,2.6vw,2rem)] font-extrabold tracking-[-0.02em] text-[var(--ink-900)]">
            {t("faq.title")}
          </h2>
        </motion.div>

        <motion.div
          variants={fadeUp}
          className="mx-auto mt-8 max-w-[760px] space-y-3"
        >
          {FAQ_KEYS.map((key) => {
            const open = openKey === key;

            return (
              <div
                key={key}
                data-faq-item={key}
                className="overflow-hidden rounded-[var(--radius-card)] border border-[var(--border-default)] bg-[var(--surface-white)] px-5"
              >
                <h3>
                  <button
                    type="button"
                    id={`faq-trigger-${key}`}
                    data-testid={`faq-trigger-${key}`}
                    aria-expanded={open}
                    aria-controls={`faq-panel-${key}`}
                    onClick={() => toggle(key)}
                    onKeyDown={(event) => handleKeyDown(event, key)}
                    className="flex min-h-14 w-full items-center justify-between gap-4 py-4 text-left text-[15px] font-bold text-[var(--ink-900)]"
                  >
                    <span>{t(`faq.items.${key}.q`)}</span>
                    <motion.span
                      aria-hidden="true"
                      animate={{ rotate: open ? 180 : 0 }}
                      transition={{ duration: 0.25, ease: OD_EASE.standard }}
                      className="inline-flex shrink-0 text-[var(--purple-600)]"
                    >
                      <ChevronDownIcon className="size-5" />
                    </motion.span>
                  </button>
                </h3>

                <AnimatePresence initial={false}>
                  {open && (
                    <motion.div
                      key={key}
                      id={`faq-panel-${key}`}
                      role="region"
                      aria-labelledby={`faq-trigger-${key}`}
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: "auto", opacity: 1 }}
                      exit={{
                        height: 0,
                        opacity: 0,
                        transition: {
                          duration: 0.2,
                          ease: OD_EASE.accelerate,
                        },
                      }}
                      transition={{ duration: 0.28, ease: OD_EASE.decelerate }}
                      className="overflow-hidden"
                    >
                      <p
                        data-testid={`faq-answer-${key}`}
                        className="pb-4 pr-8 text-[14px] leading-[1.7] text-[var(--ink-500)]"
                      >
                        {t(`faq.items.${key}.a`)}
                      </p>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            );
          })}
        </motion.div>
      </motion.div>
    </section>
  );
}
