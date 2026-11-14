import { createHash } from "node:crypto";

import type { Gender } from "@open-doing/types";

import type { DomainErrorI18n } from "@/lib/domain-error";

import {
  EMAIL_PATTERN,
  NICKNAME_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  PHONE_PATTERN,
  USERNAME_MAX_LENGTH,
  USERNAME_MIN_LENGTH,
  USERNAME_PATTERN,
} from "./constants";

export {
  INVALID_CREDENTIALS_MESSAGE,
  PASSWORD_MIN_LENGTH,
  USERNAME_MAX_LENGTH,
  USERNAME_MIN_LENGTH,
  USERNAME_TAKEN_MESSAGE,
} from "./constants";

export type AuthErrorCode =
  | "VALIDATION"
  | "REGISTRATION_CODE_INVALID"
  | "REGISTRATION_CODE_EXHAUSTED"
  | "USERNAME_TAKEN"
  | "EMAIL_TAKEN"
  | "PHONE_TAKEN"
  | "INVALID_CREDENTIALS"
  | "UID_GENERATION_FAILED";

export type AuthErrorField =
  | "registrationCode"
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
  /** 注册码（封测）：必填；trim + 去内部空白 + 大写归一化后校验。 */
  registrationCode?: string;
  username: string;
  password: string;
  /** 昵称：trim 后最长为 50 字符；空/未传时由注册 hook 按 uid 生成。 */
  nickname?: string;
  /** 性别：仅接受 "male" | "female" | "secret"；空/未传时为 null。 */
  gender?: string;
  /** 邮箱：注册必填；trim + 小写。 */
  email: string;
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
 * 展示名列不参与唯一约束，故不保证全局唯一；仅用于注册未填昵称时的展示名。
 */
export function generateNickname(uid: string): string {
  return `user_${createHash("sha256").update(uid).digest("hex").slice(0, 5)}`;
}

/**
 * 注册入参校验与归一化。
 *
 * 用户名 2–20 字符，密码至少 8 位，邮箱必填且需符合格式；昵称 ≤50
 * 字符，性别限枚举，手机号按格式校验。可选资料的空字符串一律归一化为
 * null（手机号否则会撞上 users.phone 的唯一索引）。
 *
 * 抛出 `AuthError`（带 i18n 通道），由 registerAction 的 toFailure 统一
 * 翻译并落到对应表单字段。
 */
export function validateRegistration(input: AuthInput): {
  username: string;
  password: string;
  nickname: string | null;
  gender: Gender | null;
  email: string;
  phone: string | null;
} {
  const username = normalizeUsername(input?.username);
  const password = normalizePassword(input?.password);

  if (!username) {
    throw new AuthError("VALIDATION", "请输入帐号", "username", {
      key: "usernameRequired",
    });
  }
  if (username.length < USERNAME_MIN_LENGTH || username.length > USERNAME_MAX_LENGTH) {
    throw new AuthError(
      "VALIDATION",
      `帐号需为 ${USERNAME_MIN_LENGTH}–${USERNAME_MAX_LENGTH} 个字符`,
      "username",
      {
        key: "usernameLength",
        params: { min: USERNAME_MIN_LENGTH, max: USERNAME_MAX_LENGTH },
      },
    );
  }
  // 字符集白名单：ASCII 字母 / 数字 / 下划线，禁止中文（含其他非 ASCII）。
  if (!USERNAME_PATTERN.test(username)) {
    throw new AuthError("VALIDATION", "帐号包含不支持的字符", "username", {
      key: "usernameInvalid",
    });
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
  if (!emailValue) {
    throw new AuthError("VALIDATION", "请输入邮箱", "email", {
      key: "emailRequired",
    });
  }
  if (!EMAIL_PATTERN.test(emailValue)) {
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
    email: emailValue,
    phone: phoneValue || null,
  };
}
