function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/**
 * 收集错误链（drizzle 会把驱动错误包在 DrizzleQueryError.cause 中），
 * 便于统一识别 MySQL 约束错误。
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

/** MySQL 唯一约束冲突（ER_DUP_ENTRY，errno 1062）。 */
export function isUniqueViolation(error: unknown): boolean {
  return errorChain(error).some((item) => {
    if (item.errno === 1062 || item.code === "ER_DUP_ENTRY") return true;
    const message = typeof item.message === "string" ? item.message : "";
    return message.includes("Duplicate entry");
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
 * 从 MySQL 唯一约束错误中提取被违反的索引名。
 *
 * 沿错误链逐项匹配 `constraint_name` 与 message（MySQL 的 message 形如
 * `Duplicate entry 'x' for key 'users.users_email_unique'`）；不属于
 * `UniqueKey` 的唯一冲突（如 `users_uid_unique`）返回 `null`，由调用方按
 * 自身语义处理（例如 UID 碰撞后重试）。
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
    const message = typeof item.message === "string" ? item.message : "";
    const match = UNIQUE_KEYS.find((key) => message.includes(key));
    if (match) return match;
  }

  return null;
}
