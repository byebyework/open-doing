import { eq } from "drizzle-orm";
import type { BetterAuthOptions } from "better-auth";
import { APIError, createAuthMiddleware } from "better-auth/api";

import { generateUid } from "@/lib/uid";
import { db } from "@/server/db/client";
import { registrationCodes, users } from "@/server/db/schema";

import {
  consumeRegistrationCode,
  normalizeRegistrationCode,
} from "./registration-codes";
import { generateNickname } from "./service";

/**
 * 注册链路的错误令牌：抛出 `APIError({ message, code })` 后由 action
 * 层的 `mapAuthError` 映射为字段 + i18n key（绝不透出 better-auth 的
 * 英文原文）。
 */
export const AUTH_ERROR_TOKENS = {
  regCodeInvalid: "REG_CODE_INVALID",
  regCodeExhausted: "REG_CODE_EXHAUSTED",
  uidCollision: "UID_COLLISION",
  phoneTaken: "PHONE_TAKEN",
} as const;

const SIGN_UP_PATH = "/sign-up/email";

function signUpError(token: string): APIError {
  return new APIError("BAD_REQUEST", { message: token, code: token });
}

/**
 * 注册请求的前置校验（仅 `/sign-up/email`）：
 * - 注册码去空白 + 大写归一化后重新挂回 body，供 database hook 读取；
 * - 码不存在时立即失败（无效码先于用户名/邮箱占用检查，避免泄露）。
 *
 * Spike 结论 (b)：databaseHooks.user.create.before 的第二参数就是本次
 * 请求的 endpoint context，`context.body.registrationCode` 可直接读取；
 * 无需 AsyncLocalStorage 传递。
 */
export const authRequestHooks: NonNullable<BetterAuthOptions["hooks"]> = {
  before: createAuthMiddleware(async (ctx) => {
    if (ctx.path !== SIGN_UP_PATH) return;

    const code = normalizeRegistrationCode((ctx.body as Record<string, unknown>)?.registrationCode);
    if (!code) throw signUpError(AUTH_ERROR_TOKENS.regCodeInvalid);

    const [existing] = await db
      .select({ id: registrationCodes.id })
      .from(registrationCodes)
      .where(eq(registrationCodes.code, code))
      .limit(1);
    if (!existing) throw signUpError(AUTH_ERROR_TOKENS.regCodeInvalid);

    (ctx.body as Record<string, unknown>).registrationCode = code;
  }),
};

/**
 * 用户创建前的注册钩子（随 better-auth 的 user.create 生命周期执行）：
 * 1. 生成 `doing_xxxx` UID 并预检唯一性（碰撞即中止，不重试）；
 * 2. 预检手机号唯一性（更好友好的字段错误；并发竞态由唯一索引兜底）；
 * 3. 原子消费注册码（invalid / exhausted 各自报错），成功时把码 id 写入
 *    `registration_code_id`；
 * 4. 兜底展示名（空则 `generateNickname(uid)`）与 `displayUsername`。
 *
 * Spike 结论 (a)：drizzleAdapter 默认 `transaction: false` 时 user+account
 * 两次写入不共享事务；server.ts 显式开启 `transaction: true` 后，整个
 * sign-up（user/account/session）在同一事务内，本钩子抛错会整体回滚
 * （已实测 users/accounts 均为 0 行）。
 *
 * 残余风险（spec 已接受）：本钩子里的注册码扣减使用独立的 drizzle `db`
 * 连接，不在 better-auth 事务内；若消费成功后 user 插入仍因竞态失败，
 * 该名额会被白耗。封测阶段不做补偿。
 */
export const authDatabaseHooks: NonNullable<BetterAuthOptions["databaseHooks"]> = {
  user: {
    create: {
      before: async (user, context) => {
        if (context?.path !== SIGN_UP_PATH) return { data: user };

        const body = (context.body ?? {}) as Record<string, unknown>;
        const code = normalizeRegistrationCode(body.registrationCode);

        const uid = generateUid();
        const [uidOwner] = await db
          .select({ id: users.id })
          .from(users)
          .where(eq(users.uid, uid))
          .limit(1);
        if (uidOwner) throw signUpError(AUTH_ERROR_TOKENS.uidCollision);

        const phone = typeof user.phone === "string" ? user.phone.trim() : "";
        if (phone) {
          const [phoneOwner] = await db
            .select({ id: users.id })
            .from(users)
            .where(eq(users.phone, phone))
            .limit(1);
          if (phoneOwner) throw signUpError(AUTH_ERROR_TOKENS.phoneTaken);
        }

        const consumed = await consumeRegistrationCode(code, db);
        if (consumed.outcome === "invalid") throw signUpError(AUTH_ERROR_TOKENS.regCodeInvalid);
        if (consumed.outcome === "exhausted") throw signUpError(AUTH_ERROR_TOKENS.regCodeExhausted);

        const name = typeof user.name === "string" ? user.name.trim() : "";
        const displayUsername =
          typeof user.displayUsername === "string" && user.displayUsername
            ? user.displayUsername
            : typeof user.username === "string"
              ? user.username
              : "";

        return {
          data: {
            ...user,
            uid,
            registrationCodeId: consumed.registrationCodeId,
            name: name || generateNickname(uid),
            displayUsername,
          },
        };
      },
    },
  },
};
