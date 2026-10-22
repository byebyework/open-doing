import { hash, verify } from "@node-rs/argon2";
import type { User } from "@open-doing/types";

import {
  getCredentialsByUsername,
  toUser,
  usernameExists,
} from "@/features/users/service";
import { generateUid } from "@/lib/uid";
import { db, type DbClient } from "@/server/db/client";
import { users } from "@/server/db/schema";

import {
  INVALID_CREDENTIALS_MESSAGE,
  PASSWORD_MIN_LENGTH,
  USERNAME_MAX_LENGTH,
  USERNAME_MIN_LENGTH,
  USERNAME_TAKEN_MESSAGE,
} from "./constants";
import { clearSession } from "./session";

export {
  INVALID_CREDENTIALS_MESSAGE,
  PASSWORD_MIN_LENGTH,
  USERNAME_MAX_LENGTH,
  USERNAME_MIN_LENGTH,
  USERNAME_TAKEN_MESSAGE,
} from "./constants";

/** UID 唯一约束冲突时的最大重试次数（含首次插入）。 */
const MAX_UID_ATTEMPTS = 5;

export type AuthErrorCode =
  | "VALIDATION"
  | "USERNAME_TAKEN"
  | "INVALID_CREDENTIALS"
  | "UID_GENERATION_FAILED";

export type AuthErrorField = "username" | "password" | "form";

/**
 * 认证领域错误。
 *
 * `field` 供 Server Action 映射为表单字段错误；不把数据库/哈希细节
 * 泄露给客户端。
 */
export class AuthError extends Error {
  readonly code: AuthErrorCode;
  readonly field: AuthErrorField;

  constructor(code: AuthErrorCode, message: string, field: AuthErrorField = "form") {
    super(message);
    this.name = "AuthError";
    this.code = code;
    this.field = field;
  }
}

export interface AuthInput {
  username: string;
  password: string;
}

function normalizeUsername(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizePassword(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function invalidCredentials(): AuthError {
  return new AuthError("INVALID_CREDENTIALS", INVALID_CREDENTIALS_MESSAGE, "form");
}

/** 注册入参校验：用户名 2–20 字符，密码至少 8 位。 */
function validateRegistration(input: AuthInput): { username: string; password: string } {
  const username = normalizeUsername(input?.username);
  const password = normalizePassword(input?.password);

  if (!username) {
    throw new AuthError("VALIDATION", "请输入用户名", "username");
  }
  if (username.length < USERNAME_MIN_LENGTH || username.length > USERNAME_MAX_LENGTH) {
    throw new AuthError(
      "VALIDATION",
      `用户名需为 ${USERNAME_MIN_LENGTH}–${USERNAME_MAX_LENGTH} 个字符`,
      "username",
    );
  }
  if (!password) {
    throw new AuthError("VALIDATION", "请输入密码", "password");
  }
  if (password.length < PASSWORD_MIN_LENGTH) {
    throw new AuthError(
      "VALIDATION",
      `密码至少 ${PASSWORD_MIN_LENGTH} 位`,
      "password",
    );
  }

  return { username, password };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/**
 * 收集错误链（drizzle 会把驱动错误包在 DrizzleQueryError.cause 中），
 * 便于统一识别 PostgreSQL 约束错误。
 */
function errorChain(error: unknown): Record<string, unknown>[] {
  const chain: Record<string, unknown>[] = [];
  let current: unknown = error;

  while (isRecord(current) && !chain.includes(current)) {
    chain.push(current);
    current = current.cause;
  }

  return chain;
}

/** PostgreSQL 唯一约束冲突（23505）。 */
function isUniqueViolation(error: unknown): boolean {
  return errorChain(error).some((item) => {
    if (item.code === "23505") return true;
    const message = typeof item.message === "string" ? item.message : "";
    return message.includes("duplicate key value violates unique constraint");
  });
}

/** 冲突是否发生在 users.username（其余唯一冲突按 UID 碰撞处理并重试）。 */
function isUsernameConflict(error: unknown): boolean {
  return errorChain(error).some((item) => {
    const constraint =
      typeof item.constraint_name === "string" ? item.constraint_name : "";
    const message = typeof item.message === "string" ? item.message : "";
    return (
      constraint === "users_username_unique" ||
      message.includes("users_username_unique")
    );
  });
}

/**
 * 注册用户。
 *
 * - 用户名查重给出友好错误；并发竞态由数据库唯一约束兜底；
 * - 密码用 @node-rs/argon2（默认 Argon2id）哈希，绝不明文落库；
 * - UID 碰撞依赖 `users.uid` 唯一约束重新生成，最多尝试 5 次。
 */
export async function registerUser(
  input: AuthInput,
  client: DbClient = db,
): Promise<User> {
  const { username, password } = validateRegistration(input);

  if (await usernameExists(username, client)) {
    throw new AuthError("USERNAME_TAKEN", USERNAME_TAKEN_MESSAGE, "username");
  }

  const passwordHash = await hash(password);

  for (let attempt = 1; attempt <= MAX_UID_ATTEMPTS; attempt += 1) {
    try {
      const [row] = await client
        .insert(users)
        .values({ uid: generateUid(), username, passwordHash })
        .returning({
          id: users.id,
          uid: users.uid,
          username: users.username,
          createdAt: users.createdAt,
        });

      return toUser(row!);
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;

      if (isUsernameConflict(error)) {
        throw new AuthError("USERNAME_TAKEN", USERNAME_TAKEN_MESSAGE, "username");
      }
      // 其余唯一冲突只可能来自 UID：重新生成后重试。
    }
  }

  throw new AuthError(
    "UID_GENERATION_FAILED",
    "系统繁忙，请稍后重试",
    "form",
  );
}

/**
 * 登录。
 *
 * 不存在的用户名与错误密码抛出同一个 `INVALID_CREDENTIALS`，
 * 防止通过错误信息枚举已注册用户名。
 */
export async function login(input: AuthInput, client: DbClient = db): Promise<User> {
  const username = normalizeUsername(input?.username);
  const password = normalizePassword(input?.password);

  if (!username || !password) throw invalidCredentials();

  const credentials = await getCredentialsByUsername(username, client);
  if (!credentials) throw invalidCredentials();

  let passwordMatches = false;
  try {
    passwordMatches = await verify(credentials.passwordHash, password);
  } catch {
    // 哈希损坏等异常同样按凭据错误处理，不泄露内部状态。
    passwordMatches = false;
  }

  if (!passwordMatches) throw invalidCredentials();

  return credentials.user;
}

/** 登出：清除无状态会话 cookie。 */
export async function logout(): Promise<void> {
  await clearSession();
}
