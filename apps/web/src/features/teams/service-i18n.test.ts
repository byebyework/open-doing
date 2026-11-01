import { describe, expect, it } from "vitest";

import { createTeam } from "./service";

/** TeamError 的 i18n 通道：message 保持 zh 兜底，i18n 描述符供 action 翻译。 */
describe("TeamError i18n channel", () => {
  it("名称校验错误携带 teams 命名空间 key 与插值参数（先于数据库访问抛出）", async () => {
    await expect(createTeam({ name: "" }, "actor")).rejects.toMatchObject({
      field: "name",
      i18n: { key: "nameRequired" },
    });

    await expect(createTeam({ name: "a" }, "actor")).rejects.toMatchObject({
      i18n: { key: "nameLength", params: { min: 2, max: 30 } },
    });
  });
});
