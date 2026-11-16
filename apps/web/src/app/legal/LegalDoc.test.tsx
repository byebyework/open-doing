import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { LegalDoc } from "./LegalDoc";
import type { LegalDocProps } from "./legal-doc-types";

/** 样例文案用英文串：cjk-guard 禁止测试文件硬编码中文。 */
const sampleProps: LegalDocProps = {
  title: "Privacy Policy",
  versionLabel: "Version",
  version: "2026-11-v1",
  effectiveLabel: "Effective date",
  effectiveDate: "2026-11-16",
  intro: "This policy explains how we handle your data.",
  sections: [
    {
      heading: "Data we collect",
      paragraphs: ["We collect your account name and email.", "We store task content you create."],
    },
    {
      heading: "Cookies",
      paragraphs: ["We only use a session cookie and a locale preference cookie."],
    },
  ],
};

describe("LegalDoc", () => {
  it("renders the title, version, effective date and intro", () => {
    const markup = renderToStaticMarkup(<LegalDoc {...sampleProps} />);

    expect(markup).toContain("Privacy Policy");
    expect(markup).toContain("2026-11-v1");
    expect(markup).toContain("2026-11-16");
    expect(markup).toContain("This policy explains how we handle your data.");
  });

  it("renders every section heading and its paragraphs", () => {
    const markup = renderToStaticMarkup(<LegalDoc {...sampleProps} />);

    for (const section of sampleProps.sections) {
      expect(markup).toContain(section.heading);
      for (const paragraph of section.paragraphs) {
        expect(markup).toContain(paragraph);
      }
    }
    expect(markup.match(/<h2/g)?.length).toBe(sampleProps.sections.length);
  });
});
