import { describe, expect, it } from "vitest";

import { uniqueViolationKey } from "./errors";

/** 构造 postgres-js 风格的 23505 唯一约束错误。 */
function uniqueViolation(overrides: Record<string, unknown> = {}) {
  return {
    code: "23505",
    constraint_name: "users_username_unique",
    message: 'duplicate key value violates unique constraint "users_username_unique"',
    ...overrides,
  };
}

describe("uniqueViolationKey", () => {
  it("message 含 users_email_unique → 返回 users_email_unique", () => {
    const error = uniqueViolation({
      constraint_name: undefined,
      message: 'duplicate key value violates unique constraint "users_email_unique"',
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
          uniqueViolation({
            constraint_name: key,
            message: "duplicate key value violates unique constraint",
          }),
        ),
      ).toBe(key);
    }
  });

  it("drizzle 包装的 cause 链同样能识别", () => {
    const error = new Error("DrizzleQueryError: Failed query");
    Object.assign(error, {
      cause: uniqueViolation({
        constraint_name: undefined,
        message: 'duplicate key value violates unique constraint "users_phone_unique"',
      }),
    });

    expect(uniqueViolationKey(error)).toBe("users_phone_unique");
  });

  it("非唯一约束错误 → null", () => {
    expect(uniqueViolationKey(new Error("connection lost"))).toBeNull();
    expect(uniqueViolationKey(null)).toBeNull();
    expect(uniqueViolationKey("users_email_unique")).toBeNull();
  });

  it("仍是 23505 但索引名不在已知范围（users_uid_unique）→ null", () => {
    const error = uniqueViolation({
      constraint_name: "users_uid_unique",
      message: 'duplicate key value violates unique constraint "users_uid_unique"',
    });

    expect(uniqueViolationKey(error)).toBeNull();
  });

  it("非驱动错误的 message 提到已知索引名 → null（不匹配包装层 SQL/参数噪音）", () => {
    expect(uniqueViolationKey({ message: "users_email_unique is already used" })).toBeNull();
    expect(
      uniqueViolationKey({
        message:
          'Failed query: insert into "users" ("email") values ($1)\nparams: users_email_unique@example.com',
      }),
    ).toBeNull();
  });

  it("无 code 时即使 message 形似驱动错误也不匹配（message 正则仅对驱动错误启用）", () => {
    expect(
      uniqueViolationKey({
        message:
          'duplicate key value violates unique constraint "users_email_unique"',
      }),
    ).toBeNull();
  });

  it("Drizzle 包装层参数含索引名时不误报，仍识别 cause 的真实冲突", () => {
    const wrapper = {
      message:
        'Failed query: insert into "users" ("email") values ($1)\nparams: users_email_unique@example.com',
      cause: uniqueViolation({
        constraint_name: undefined,
        message: 'duplicate key value violates unique constraint "users_phone_unique"',
      }),
    };

    expect(uniqueViolationKey(wrapper)).toBe("users_phone_unique");
  });

  it("包装层参数含完整驱动 message 也不当作驱动错误", () => {
    const wrapper = {
      message:
        'Failed query: insert into "users" ("username") values ($1)\nparams: duplicate key value violates unique constraint "users_username_unique"',
      cause: uniqueViolation({
        constraint_name: undefined,
        message: 'duplicate key value violates unique constraint "users_email_unique"',
      }),
    };

    expect(uniqueViolationKey(wrapper)).toBe("users_email_unique");
  });

  it("message 同时出现另一个索引名时以 unique constraint 引号内名称为准", () => {
    const error = uniqueViolation({
      constraint_name: undefined,
      message:
        'duplicate key value violates unique constraint "users_phone_unique"; Key (phone)=(users_email_unique@x.com) already exists.',
    });

    expect(uniqueViolationKey(error)).toBe("users_phone_unique");
  });

  it("驱动错误 message 无 unique constraint 段 → null", () => {
    expect(
      uniqueViolationKey(
        uniqueViolation({
          constraint_name: undefined,
          message: "duplicate key value violates unique constraint",
        }),
      ),
    ).toBeNull();
  });
});
