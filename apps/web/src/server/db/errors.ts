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

/** PostgreSQL 唯一约束冲突（23505）。 */
export function isUniqueViolation(error: unknown): boolean {
  return errorChain(error).some((item) => {
    if (item.code === "23505") return true;
    const message = typeof item.message === "string" ? item.message : "";
    return message.includes("duplicate key value violates unique constraint");
  });
}
