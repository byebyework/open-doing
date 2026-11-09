import { and, desc, eq, lt, sql } from "drizzle-orm";

import { generateJoinCode } from "@/lib/join-code";
import { db, type DbClient } from "@/server/db/client";
import { isUniqueViolation } from "@/server/db/errors";
import { registrationCodes } from "@/server/db/schema";

/** 每个注册码的固定使用次数上限（封测策略，一码多用）。 */
export const REGISTRATION_CODE_MAX_USES = 10;

/** 唯一冲突重试上限：码空间 31⁸ ≈ 8.5×10¹¹，碰撞概率可忽略，防御性上限。 */
const MAX_CODE_ATTEMPTS = 5;

/** 消费注册码的结果：成功 / 码不存在 / 次数已用尽。 */
export type RegistrationCodeConsumeResult = "ok" | "invalid" | "exhausted";

export interface RegistrationCodeSummary {
  code: string;
  usedCount: number;
  maxUses: number;
  createdAt: Date;
}

/**
 * 注册码输入归一化：与团队入群码同规则——去掉全部空白并转大写
 * （码本身由大写字符集生成，大小写不敏感便于口头转述/手抄）。
 */
export function normalizeRegistrationCode(value: unknown): string {
  return typeof value === "string" ? value.replace(/\s+/g, "").toUpperCase() : "";
}

/**
 * 生成 N 个注册码并落库（一码多用，上限固定为 REGISTRATION_CODE_MAX_USES）。
 *
 * 码复用入群码生成器（8 位大写字母数字，不含易混淆字符）；唯一冲突时
 * 重新生成重试，由 `registration_codes_code_unique` 唯一索引兜底。
 */
export async function generateRegistrationCodes(
  count: number,
  client: DbClient = db,
): Promise<string[]> {
  const codes: string[] = [];

  for (let i = 0; i < count; i += 1) {
    for (let attempt = 1; attempt <= MAX_CODE_ATTEMPTS; attempt += 1) {
      const code = generateJoinCode();
      try {
        await client.insert(registrationCodes).values({
          code,
          maxUses: REGISTRATION_CODE_MAX_USES,
        });
        codes.push(code);
        break;
      } catch (error) {
        if (!isUniqueViolation(error) || attempt === MAX_CODE_ATTEMPTS) throw error;
      }
    }
  }

  return codes;
}

/** 查询全部注册码（按创建时间倒序），供管理脚本查看使用情况。 */
export async function listRegistrationCodes(
  client: DbClient = db,
): Promise<RegistrationCodeSummary[]> {
  return client
    .select({
      code: registrationCodes.code,
      usedCount: registrationCodes.usedCount,
      maxUses: registrationCodes.maxUses,
      createdAt: registrationCodes.createdAt,
    })
    .from(registrationCodes)
    .orderBy(desc(registrationCodes.createdAt));
}

/**
 * 消费一个注册码名额。
 *
 * 用**原子条件更新**扣减（`WHERE code = ? AND used_count < max_uses`），
 * 并发下最多只有一个请求命中，不会超发。未命中时回查区分
 * 「码不存在」（invalid）与「次数用尽」（exhausted），供注册流程
 * 映射为不同的字段错误。
 */
export async function consumeRegistrationCode(
  code: string,
  client: DbClient = db,
): Promise<RegistrationCodeConsumeResult> {
  const normalized = normalizeRegistrationCode(code);
  if (!normalized) return "invalid";

  const rows = await client
    .update(registrationCodes)
    .set({ usedCount: sql`${registrationCodes.usedCount} + 1` })
    .where(
      and(
        eq(registrationCodes.code, normalized),
        lt(registrationCodes.usedCount, registrationCodes.maxUses),
      ),
    )
    .returning({ id: registrationCodes.id });

  if (rows.length > 0) return "ok";

  const [row] = await client
    .select({ usedCount: registrationCodes.usedCount })
    .from(registrationCodes)
    .where(eq(registrationCodes.code, normalized))
    .limit(1);

  return row ? "exhausted" : "invalid";
}
