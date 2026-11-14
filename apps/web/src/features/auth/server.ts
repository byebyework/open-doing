import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { nextCookies } from "better-auth/next-js";
import { username } from "better-auth/plugins";

import { db } from "@/server/db/client";
import { accounts, sessions, users, verifications } from "@/server/db/schema";

import { authDatabaseHooks, authRequestHooks } from "./hooks";

/**
 * 读取 better-auth 会话签名密钥。
 *
 * 生产环境必须显式配置；开发/测试环境回退到固定开发密钥，
 * 避免本地未建 `.env.local` 时整站不可用（生产缺失会直接报错）。
 */
export function getSessionSecret(): string {
  const secret = process.env.BETTER_AUTH_SECRET;
  if (secret) return secret;

  if (process.env.NODE_ENV === "production") {
    throw new Error("缺少 BETTER_AUTH_SECRET 环境变量");
  }

  return "open-doing-dev-only-session-secret";
}

/**
 * 唯一的 better-auth 实例（服务端专用）。
 *
 * - `users` 表同时是 better-auth 的 user 模型，sessions/accounts/verifications
 *   为其核心三表；drizzleAdapter 的 schema 键必须使用 better-auth 的模型名；
 * - `nextCookies()` 负责在 Server Action / Route Handler 中自动写入 Set-Cookie，
 *   **必须放在 plugins 数组最后**；
 * - username 插件关闭小写归一化：用户名大小写敏感（`Alice` 与 `alice` 可并存）；
 * - additionalFields 中 `input: false` 的字段不接受注册入参，由服务端补齐
 *   （uid / 注册码 id 由注册 hook 生成；language / 提醒开关 / isAdmin /
 *   isDisabled 走默认值，后两者由管理台写入）。
 */
export const auth = betterAuth({
  secret: getSessionSecret(),
  baseURL: process.env.BETTER_AUTH_URL,
  advanced: {
    database: {
      // better-auth 默认生成 32 位字母数字 ID，与库中 `uuid` 主键不兼容
      // （首次写入即报 invalid input syntax for type uuid）。用 "uuid" 生成
      // 标准 UUID；drizzle adapter 的 supportsUUIDs 会省略 id，让
      // `defaultRandom()`（gen_random_uuid()）在库端填充。
      generateId: "uuid",
    },
  },
  database: drizzleAdapter(db, {
    provider: "pg",
    schema: {
      user: users,
      session: sessions,
      account: accounts,
      verification: verifications,
    },
    // better-auth 默认 transaction:false（drizzle adapter 的 user/account 两次
    // 写入不在同一事务）。注册链路要求建号原子性：本钩子内的抛错可整体回滚。
    transaction: true,
  }),
  hooks: authRequestHooks,
  databaseHooks: authDatabaseHooks,
  emailAndPassword: {
    enabled: true,
    minPasswordLength: 8,
  },
  session: {
    expiresIn: 60 * 60 * 24 * 30,
  },
  user: {
    additionalFields: {
      uid: { type: "string", required: false, input: false },
      // 注册时消费的注册码 id，由 user.create.before 钩子写入，客户端不可传。
      registrationCodeId: { type: "string", required: false, input: false },
      // 管理员工作台标记：进入会话用户（getCurrentUser / requireAdmin 读取），
      // 由管理台服务端写入，客户端不可传。
      isAdmin: { type: "boolean", required: false, input: false, defaultValue: false },
      isDisabled: { type: "boolean", required: false, input: false, defaultValue: false },
      gender: { type: "string", required: false, input: true },
      phone: { type: "string", required: false, input: true },
      language: { type: "string", required: false, input: false, defaultValue: "zh" },
      dueSoonReminderEnabled: {
        type: "boolean",
        required: false,
        input: false,
        defaultValue: true,
      },
      overdueReminderEnabled: {
        type: "boolean",
        required: false,
        input: false,
        defaultValue: true,
      },
    },
  },
  plugins: [
    username({
      usernameNormalization: false,
      minUsernameLength: 2,
      maxUsernameLength: 20,
      // 现有产品语义只限制 2–20 字符（大小写敏感、允许中文/空格等）；
      // better-auth 默认的 `[a-zA-Z0-9_.]` 校验会收紧语义，故放开字符集。
      usernameValidator: () => true,
    }),
    nextCookies(),
  ],
});
