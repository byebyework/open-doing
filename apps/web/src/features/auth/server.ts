import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { nextCookies } from "better-auth/next-js";
import { username } from "better-auth/plugins";

import { db } from "@/server/db/client";
import { accounts, sessions, users, verifications } from "@/server/db/schema";

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
 *   （uid 由注册 hook 生成；language / 提醒开关走默认值）。
 */
export const auth = betterAuth({
  secret: getSessionSecret(),
  baseURL: process.env.BETTER_AUTH_URL,
  database: drizzleAdapter(db, {
    provider: "pg",
    schema: {
      user: users,
      session: sessions,
      account: accounts,
      verification: verifications,
    },
  }),
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
    }),
    nextCookies(),
  ],
});
