import dayjs from "dayjs";
import relativeTime from "dayjs/plugin/relativeTime";
import { describe, expect, it } from "vitest";

import { setDayjsLocale } from "./dayjs-locale";

dayjs.extend(relativeTime);

describe("setDayjsLocale", () => {
  it("zh 应用 zh-cn，相对时间为中文", () => {
    expect(setDayjsLocale("zh")).toBe("zh-cn");
    expect(dayjs().subtract(3, "hour").fromNow()).toContain("小时");
  });

  it("en 应用 en，相对时间为英文", () => {
    expect(setDayjsLocale("en")).toBe("en");
    expect(dayjs().subtract(3, "hour").fromNow()).toMatch(/hours? ago/);
  });
});
