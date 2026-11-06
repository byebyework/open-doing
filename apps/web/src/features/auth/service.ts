import { hash, verify } from "@node-rs/argon2";
import type { User } from "@open-doing/types";
import { eq } from "drizzle-orm";

import {
  getCredentialsByUsername,
  toUser,
  usernameExists,
} from "@/features/users/service";
import type { DomainErrorI18n } from "@/lib/domain-error";
import { generateUid } from "@/lib/uid";
import { db, type DbClient } from "@/server/db/client";
import { errorChain, isUniqueViolation } from "@/server/db/errors";
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

export type AuthErrorField =
  | "username"
  | "password"
  | "oldPassword"
  | "newPassword"
  | "form";

/**
 * 认证领域错误。
 *
 * `field` 供 Server Action 映射为表单字段错误；不把数据库/哈希细节
 * 泄露给客户端。`i18n` 为可选翻译通道（与 DomainError 同构）：
 * `message` 保持 zh 兜底，携带 i18n 时由 action 按请求语言翻译。
 */
export class AuthError extends Error {
  readonly code: AuthErrorCode;
  readonly field: AuthErrorField;
  readonly i18n?: DomainErrorI18n;

  constructor(
    code: AuthErrorCode,
    message: string,
    field: AuthErrorField = "form",
    i18n?: DomainErrorI18n,
  ) {
    super(message);
    this.name = "AuthError";
    this.code = code;
    this.field = field;
    this.i18n = i18n;
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
  return new AuthError("INVALID_CREDENTIALS", INVALID_CREDENTIALS_MESSAGE, "form", {
    key: "invalidCredentials",
  });
}

/** 注册入参校验：用户名 2–20 字符，密码至少 8 位。 */
function validateRegistration(input: AuthInput): { username: string; password: string } {
  const username = normalizeUsername(input?.username);
  const password = normalizePassword(input?.password);

  if (!username) {
    throw new AuthError("VALIDATION", "请输入用户名", "username", {
      key: "usernameRequired",
    });
  }
  if (username.length < USERNAME_MIN_LENGTH || username.length > USERNAME_MAX_LENGTH) {
    throw new AuthError(
      "VALIDATION",
      `用户名需为 ${USERNAME_MIN_LENGTH}–${USERNAME_MAX_LENGTH} 个字符`,
      "username",
      {
        key: "usernameLength",
        params: { min: USERNAME_MIN_LENGTH, max: USERNAME_MAX_LENGTH },
      },
    );
  }
  if (!password) {
    throw new AuthError("VALIDATION", "请输入密码", "password", {
      key: "passwordRequired",
    });
  }
  if (password.length < PASSWORD_MIN_LENGTH) {
    throw new AuthError(
      "VALIDATION",
      `密码至少 ${PASSWORD_MIN_LENGTH} 位`,
      "password",
      { key: "passwordMinLength", params: { min: PASSWORD_MIN_LENGTH } },
    );
  }

  return { username, password };
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
    throw new AuthError("USERNAME_TAKEN", USERNAME_TAKEN_MESSAGE, "username", {
      key: "usernameTaken",
    });
  }

  const passwordHash = await hash(password);

  for (let attempt = 1; attempt <= MAX_UID_ATTEMPTS; attempt += 1) {
    try {
      // MySQL 无 RETURNING：先取应用层生成的 UUID，再在同一 client 上回查。
      const [inserted] = await client
        .insert(users)
        .values({ uid: generateUid(), username, passwordHash })
        .$returningId();

      const [row] = await client
        .select({
          id: users.id,
          uid: users.uid,
          username: users.username,
          nickname: users.nickname,
          gender: users.gender,
          email: users.email,
          phone: users.phone,
          createdAt: users.createdAt,
        })
        .from(users)
        .where(eq(users.id, inserted!.id))
        .limit(1);

      return toUser(row!);
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;

      if (isUsernameConflict(error)) {
        throw new AuthError("USERNAME_TAKEN", USERNAME_TAKEN_MESSAGE, "username", {
          key: "usernameTaken",
        });
      }
      // 其余唯一冲突只可能来自 UID：重新生成后重试。
    }
  }

  throw new AuthError(
    "UID_GENERATION_FAILED",
    "系统繁忙，请稍后重试",
    "form",
    { key: "uidGenerationFailed" },
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

export interface ChangePasswordInput {
  userId: string;
  oldPassword: string;
  newPassword: string;
}

/**
 * 修改密码。
 *
 * - 新密码先做长度校验（与注册同一规则），旧密码错误与登录同用
 *   `INVALID_CREDENTIALS`，但落到 `oldPassword` 字段；
 * - 旧密码校验通过后重新哈希写入，绝不明文落库；
 * - 不触碰会话：无状态 JWT 继续有效，用户保持登录。
 */
export async function changePassword(
  input: ChangePasswordInput,
  client: DbClient = db,
): Promise<true> {
  const newPassword = normalizePassword(input?.newPassword);

  // 空密码（长度 0）同样落入该分支：两处共用同一锁定文案。
  if (newPassword.length < PASSWORD_MIN_LENGTH) {
    throw new AuthError(
      "VALIDATION",
      `新密码至少 ${PASSWORD_MIN_LENGTH} 位`,
      "newPassword",
      { key: "newPasswordMinLength", params: { min: PASSWORD_MIN_LENGTH } },
    );
  }

  const userId = typeof input?.userId === "string" ? input.userId : "";
  const [credentials] = await client
    .select({ passwordHash: users.passwordHash })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  const oldPassword = normalizePassword(input?.oldPassword);
  let oldPasswordMatches = false;
  if (credentials) {
    try {
      oldPasswordMatches = await verify(credentials.passwordHash, oldPassword);
    } catch {
      // 哈希损坏等异常同样按旧密码错误处理，不泄露内部状态。
      oldPasswordMatches = false;
    }
  }

  if (!oldPasswordMatches) {
    throw new AuthError("INVALID_CREDENTIALS", "旧密码不正确", "oldPassword", {
      key: "oldPasswordIncorrect",
    });
  }

  await client
    .update(users)
    .set({ passwordHash: await hash(newPassword) })
    .where(eq(users.id, userId));

  return true;
}

/** 登出：清除无状态会话 cookie。 */
export async function logout(): Promise<void> {
  await clearSession();
}
