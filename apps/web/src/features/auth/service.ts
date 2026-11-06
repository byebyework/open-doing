import { createHash } from "node:crypto";

import { hash, verify } from "@node-rs/argon2";
import type { Gender, User } from "@open-doing/types";
import { eq } from "drizzle-orm";

import {
  getCredentialsByUsername,
  toUser,
  usernameExists,
} from "@/features/users/service";
import type { DomainErrorI18n } from "@/lib/domain-error";
import { generateUid } from "@/lib/uid";
import { db, type DbClient } from "@/server/db/client";
import { isUniqueViolation, uniqueViolationKey } from "@/server/db/errors";
import { users } from "@/server/db/schema";

import {
  EMAIL_PATTERN,
  INVALID_CREDENTIALS_MESSAGE,
  NICKNAME_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  PHONE_PATTERN,
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

const EMAIL_TAKEN_MESSAGE = "邮箱已被使用";
const PHONE_TAKEN_MESSAGE = "手机号已被使用";

export type AuthErrorCode =
  | "VALIDATION"
  | "USERNAME_TAKEN"
  | "EMAIL_TAKEN"
  | "PHONE_TAKEN"
  | "INVALID_CREDENTIALS"
  | "UID_GENERATION_FAILED";

export type AuthErrorField =
  | "username"
  | "password"
  | "nickname"
  | "gender"
  | "email"
  | "phone"
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
  /** 昵称：trim 后最长为 50 字符；空/未传时按 uid 生成默认昵称。 */
  nickname?: string;
  /** 性别：仅接受 "male" | "female" | "secret"；空/未传时为 null。 */
  gender?: string;
  /** 邮箱：trim + 小写；空字符串归一化为 null。 */
  email?: string;
  /** 手机号：trim；空字符串归一化为 null。 */
  phone?: string;
}

function normalizeUsername(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizePassword(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/** 可选文本字段：非字符串视为未填，统一 trim。 */
function normalizeOptionalText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function isGender(value: string): value is Gender {
  return value === "male" || value === "female" || value === "secret";
}

/**
 * 由 uid 生成默认昵称：`user_` + sha256(uid) 的前 5 位小写十六进制。
 *
 * 昵称列不参与唯一约束，故不保证全局唯一；仅用于注册未填昵称时的展示名。
 */
export function generateNickname(uid: string): string {
  return `user_${createHash("sha256").update(uid).digest("hex").slice(0, 5)}`;
}

function invalidCredentials(): AuthError {
  return new AuthError("INVALID_CREDENTIALS", INVALID_CREDENTIALS_MESSAGE, "form", {
    key: "invalidCredentials",
  });
}

/**
 * 注册入参校验与归一化。
 *
 * 用户名 2–20 字符，密码至少 8 位；昵称 ≤50 字符，性别限枚举，
 * 邮箱/手机号按格式校验。可选资料的空字符串一律归一化为 null
 * （否则第二个空邮箱会撞上 users.email 的唯一索引）。
 */
function validateRegistration(input: AuthInput): {
  username: string;
  password: string;
  nickname: string | null;
  gender: Gender | null;
  email: string | null;
  phone: string | null;
} {
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

  const nickname = normalizeOptionalText(input?.nickname);
  if (nickname.length > NICKNAME_MAX_LENGTH) {
    throw new AuthError(
      "VALIDATION",
      `昵称最多 ${NICKNAME_MAX_LENGTH} 个字符`,
      "nickname",
      { key: "nicknameMaxLength", params: { max: NICKNAME_MAX_LENGTH } },
    );
  }

  const genderValue = normalizeOptionalText(input?.gender);
  let gender: Gender | null = null;
  if (genderValue) {
    if (!isGender(genderValue)) {
      throw new AuthError("VALIDATION", "性别取值不合法", "gender", {
        key: "genderInvalid",
      });
    }
    gender = genderValue;
  }

  const emailValue = normalizeOptionalText(input?.email).toLowerCase();
  if (emailValue && !EMAIL_PATTERN.test(emailValue)) {
    throw new AuthError("VALIDATION", "邮箱格式不正确", "email", {
      key: "emailInvalid",
    });
  }

  const phoneValue = normalizeOptionalText(input?.phone);
  if (phoneValue && !PHONE_PATTERN.test(phoneValue)) {
    throw new AuthError("VALIDATION", "手机号格式不正确", "phone", {
      key: "phoneInvalid",
    });
  }

  return {
    username,
    password,
    nickname: nickname || null,
    gender,
    email: emailValue || null,
    phone: phoneValue || null,
  };
}

/**
 * 注册用户。
 *
 * - 用户名查重给出友好错误；并发竞态由数据库唯一约束兜底；
 * - 可选资料（昵称/性别/邮箱/手机号）归一化后落库，未填昵称按 uid 生成；
 * - 密码用 @node-rs/argon2（默认 Argon2id）哈希，绝不明文落库；
 * - 邮箱/手机号唯一冲突按索引名分派为对应字段错误；
 * - UID 碰撞依赖 `users.uid` 唯一约束重新生成，最多尝试 5 次。
 */
export async function registerUser(
  input: AuthInput,
  client: DbClient = db,
): Promise<User> {
  const { username, password, nickname, gender, email, phone } =
    validateRegistration(input);

  if (await usernameExists(username, client)) {
    throw new AuthError("USERNAME_TAKEN", USERNAME_TAKEN_MESSAGE, "username", {
      key: "usernameTaken",
    });
  }

  const passwordHash = await hash(password);

  for (let attempt = 1; attempt <= MAX_UID_ATTEMPTS; attempt += 1) {
    try {
      // MySQL 无 RETURNING：先取应用层生成的 UUID，再在同一 client 上回查。
      const uid = generateUid();
      const [inserted] = await client
        .insert(users)
        .values({
          uid,
          username,
          passwordHash,
          nickname: nickname ?? generateNickname(uid),
          gender,
          email,
          phone,
        })
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

      // 唯一冲突按被违反的索引分派；先分派业务唯一键，再解释为 UID 碰撞。
      const key = uniqueViolationKey(error);

      if (key === "users_username_unique") {
        throw new AuthError("USERNAME_TAKEN", USERNAME_TAKEN_MESSAGE, "username", {
          key: "usernameTaken",
        });
      }
      if (key === "users_email_unique") {
        throw new AuthError("EMAIL_TAKEN", EMAIL_TAKEN_MESSAGE, "email", {
          key: "emailTaken",
        });
      }
      if (key === "users_phone_unique") {
        throw new AuthError("PHONE_TAKEN", PHONE_TAKEN_MESSAGE, "phone", {
          key: "phoneTaken",
        });
      }
      // key 为 null：其余唯一冲突只可能来自 UID，重新生成后重试。
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
