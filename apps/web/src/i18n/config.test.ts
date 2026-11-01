import { describe, expect, it } from "vitest";

import {
  DEFAULT_LOCALE,
  DAYJS_LOCALE_NAME,
  LOCALE_COOKIE,
  LOCALE_COOKIE_MAX_AGE,
  LOCALE_HTML_LANG,
  normalizeLocale,
  resolveRequestLocale,
} from "./config";

describe("normalizeLocale", () => {
  it("passes through supported locales", () => {
    expect(normalizeLocale("zh")).toBe("zh");
    expect(normalizeLocale("en")).toBe("en");
  });

  it("falls back to zh for unsupported or missing values", () => {
    expect(normalizeLocale("fr")).toBe("zh");
    expect(normalizeLocale("")).toBe("zh");
    expect(normalizeLocale("zh_CN")).toBe("zh");
    expect(normalizeLocale("garbage中文")).toBe("zh");
    expect(normalizeLocale(undefined)).toBe("zh");
    expect(normalizeLocale(null)).toBe("zh");
  });
});

describe("resolveRequestLocale", () => {
  it("prefers a valid user language over the cookie", () => {
    expect(
      resolveRequestLocale({ userLanguage: "en", cookieLocale: "zh" }),
    ).toBe("en");
    expect(
      resolveRequestLocale({ userLanguage: "zh", cookieLocale: "en" }),
    ).toBe("zh");
  });

  it("falls back to the cookie when the user language is missing or invalid", () => {
    expect(resolveRequestLocale({ userLanguage: null, cookieLocale: "en" })).toBe(
      "en",
    );
    expect(resolveRequestLocale({ userLanguage: "fr", cookieLocale: "en" })).toBe(
      "en",
    );
  });

  it("falls back to zh when neither the user nor the cookie is valid", () => {
    expect(resolveRequestLocale({})).toBe("zh");
    expect(resolveRequestLocale({ userLanguage: null, cookieLocale: "fr" })).toBe(
      "zh",
    );
  });
});

describe("constants", () => {
  it("matches the plan's pinned values", () => {
    expect(DEFAULT_LOCALE).toBe("zh");
    expect(LOCALE_COOKIE).toBe("od_locale");
    expect(LOCALE_COOKIE_MAX_AGE).toBe(60 * 60 * 24 * 365);
    expect(LOCALE_HTML_LANG).toEqual({ zh: "zh-CN", en: "en-US" });
    expect(DAYJS_LOCALE_NAME).toEqual({ zh: "zh-cn", en: "en" });
  });
});
