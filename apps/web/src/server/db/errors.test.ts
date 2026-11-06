import { describe, expect, it } from "vitest";

import { uniqueViolationKey } from "./errors";

/** 构造 mysql2 风格的 ER_DUP_ENTRY 错误对象。 */
function duplicateEntry(overrides: Record<string, unknown> = {}) {
  return {
    errno: 1062,
    code: "ER_DUP_ENTRY",
    message: "Duplicate entry 'value' for key 'users.users_username_unique'",
    ...overrides,
  };
}

describe("uniqueViolationKey", () => {
  it("message 含 users_email_unique → 返回 users_email_unique", () => {
    const error = duplicateEntry({
      message: "Duplicate entry 'a@example.com' for key 'users.users_email_unique'",
    });

    expect(uniqueViolationKey(error)).toBe("users_email_unique");
  });

  it("constraint_name 命中时返回对应索引名（username / email / phone）", () => {
    for (const key of [
      "users_username_unique",
      "users_email_unique",
      "users_phone_unique",
    ] as const) {
      expect(
        uniqueViolationKey(
          duplicateEntry({ constraint_name: key, message: "Duplicate entry" }),
        ),
      ).toBe(key);
    }
  });

  it("drizzle 包装的 cause 链同样能识别", () => {
    const error = new Error("DrizzleQueryError: Failed query");
    Object.assign(error, {
      cause: duplicateEntry({
        message: "Duplicate entry '13800000000' for key 'users.users_phone_unique'",
      }),
    });

    expect(uniqueViolationKey(error)).toBe("users_phone_unique");
  });

  it("非唯一约束错误 → null", () => {
    expect(uniqueViolationKey(new Error("connection lost"))).toBeNull();
    expect(uniqueViolationKey(null)).toBeNull();
    expect(uniqueViolationKey("users_email_unique")).toBeNull();
  });

  it("仍是 1062 但索引名不在已知范围（users_uid_unique）→ null", () => {
    const error = duplicateEntry({
      message: "Duplicate entry 'doing_x7k2m9' for key 'users.users_uid_unique'",
    });

    expect(uniqueViolationKey(error)).toBeNull();
  });
});
