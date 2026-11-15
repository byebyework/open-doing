function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/**
 * 收集错误链（drizzle 会把驱动错误包在 DrizzleQueryError.cause 中），
 * 便于统一识别 PostgreSQL 约束错误。
 */
export function errorChain(error: unknown): Record<string, unknown>[] {
  const chain: Record<string, unknown>[] = [];
  let current: unknown = error;

  while (isRecord(current) && !chain.includes(current)) {
    chain.push(current);
    current = current.cause;
  }

  return chain;
}

/** PostgreSQL 唯一约束冲突（SQLSTATE 23505）。 */
export function isUniqueViolation(error: unknown): boolean {
  return errorChain(error).some((item) => {
    if (item.code === "23505") return true;
    const message = typeof item.message === "string" ? item.message : "";
    return message.includes("duplicate key value violates unique constraint");
  });
}

/** 应用需要区分处理的唯一索引（与 drizzle 迁移中的约束名保持一致）。 */
export type UniqueKey =
  | "users_username_unique"
  | "users_email_unique"
  | "users_phone_unique";

const UNIQUE_KEYS: readonly UniqueKey[] = [
  "users_username_unique",
  "users_email_unique",
  "users_phone_unique",
];

/**
 * 错误链中的某一项是否为 postgres-js 驱动抛出的唯一约束错误。
 *
 * postgres-js 的驱动错误携带 SQLSTATE `code`；DrizzleQueryError 包装层没有
 * 该字段，其 message 只是 `Failed query: <sql>\nparams: <params>` 的拼接，
 * 而 params 来自用户输入（可能包含索引名，如
 * `users_email_unique@example.com`）。message 匹配必须先通过该检查，
 * 否则会把参数噪音误判为冲突来源。
 */
function isDriverUniqueViolation(item: Record<string, unknown>): boolean {
  return item.code === "23505";
}

/** postgres-js 驱动 message 的 unique constraint 段。 */
const DRIVER_CONSTRAINT_PATTERN = /duplicate key value violates unique constraint "(\w+)"/;

/**
 * 从 PostgreSQL 唯一约束错误中提取被违反的索引名。
 *
 * 先从错误链任意一项的 `constraint_name` 精确匹配（驱动字段，安全）；
 * 再仅对**驱动错误**（SQLSTATE 23505）的 message 用正则提取
 * `unique constraint "..."` 里的索引名后精确匹配（postgres-js 的 message
 * 形如 `duplicate key value violates unique constraint "users_email_unique"`）。
 * 按索引名提取而非子串查找：message 的 detail 段或用户参数里可能出现
 * 另一个索引名（如手机号 `users_email_unique@x.com`），子串匹配会误归属。
 * Drizzle 包装层的 message 内嵌 SQL 与用户参数，因此不参与 message 匹配，
 * 避免参数里的索引名造成误报。不属于 `UniqueKey` 的唯一冲突（如
 * `users_uid_unique`）返回 `null`，由调用方按自身语义处理（例如 UID 碰撞
 * 后重试）。
 */
export function uniqueViolationKey(error: unknown): UniqueKey | null {
  const chain = errorChain(error);

  for (const item of chain) {
    const constraint =
      typeof item.constraint_name === "string" ? item.constraint_name : "";
    const match = UNIQUE_KEYS.find((key) => constraint === key);
    if (match) return match;
  }

  for (const item of chain) {
    if (!isDriverUniqueViolation(item)) continue;
    const message = typeof item.message === "string" ? item.message : "";
    const index = DRIVER_CONSTRAINT_PATTERN.exec(message)?.[1];
    if (index === undefined) continue;
    const match = UNIQUE_KEYS.find((key) => key === index);
    if (match) return match;
  }

  return null;
}
