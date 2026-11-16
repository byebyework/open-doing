import type { LegalDocProps } from "./legal-doc-types";

/**
 * 法律文档（隐私政策 / 用户协议）纯展示组件。
 *
 * 服务端组件，不持有状态；文案全部来自调用方（legal 页面从消息包映射）。
 * 颜色只走 token 变量；排版为窄栏文档流（h1 → 版本行 → intro → 分节）。
 */
export function LegalDoc({
  title,
  versionLabel,
  version,
  effectiveLabel,
  effectiveDate,
  intro,
  sections,
}: LegalDocProps) {
  return (
    <article className="mx-auto max-w-2xl px-6 py-12">
      <h1 className="text-[26px] font-extrabold tracking-[-0.01em] text-[var(--ink-900)]">
        {title}
      </h1>
      <p className="mt-2 text-[13px] text-[var(--ink-400)]">
        {versionLabel} {version} · {effectiveLabel} {effectiveDate}
      </p>
      <p className="mt-6 text-[14px] leading-6 text-[var(--ink-700)]">{intro}</p>

      {sections.map((section) => (
        <section key={section.heading} className="mt-8">
          <h2 className="text-[16px] font-bold text-[var(--ink-900)]">{section.heading}</h2>
          {section.paragraphs.map((paragraph, index) => (
            <p
              key={index}
              className="mt-3 text-[14px] leading-6 text-[var(--ink-700)]"
            >
              {paragraph}
            </p>
          ))}
        </section>
      ))}
    </article>
  );
}
