import type { Gender, User } from "@open-doing/types";
import { eq } from "drizzle-orm";

import { DomainError, type DomainErrorI18n } from "@/lib/domain-error";
import type { AppLocale } from "@/i18n/config";
import { db, type DbClient } from "@/server/db/client";
import { isUniqueViolation, uniqueViolationKey } from "@/server/db/errors";
import { users } from "@/server/db/schema";

import {
  EMAIL_PATTERN,
  NICKNAME_MAX_LENGTH,
  PHONE_PATTERN,
} from "./constants";

/** users 表中可映射为领域模型的列。 */
type UserRow = {
  id: string;
  uid: string;
  username: string;
  nickname: string | null;
  gender: Gender | null;
  email: string | null;
  phone: string | null;
  createdAt: Date;
};

/** 数据库行 -> 可跨边界传递的领域 User（时间统一为 ISO 字符串）。 */
export function toUser(row: UserRow): User {
  return {
    id: row.id,
    uid: row.uid,
    username: row.username,
    nickname: row.nickname,
    gender: row.gender,
    email: row.email,
    phone: row.phone,
    createdAt: row.createdAt.toISOString(),
  };
}

/** 按内部主键查询用户；不存在返回 null。 */
export async function getUserById(
  id: string,
  client: DbClient = db,
): Promise<User | null> {
  const [row] = await client.select().from(users).where(eq(users.id, id)).limit(1);
  return row ? toUser(row) : null;
}

/** 按对外 UID（doing_xxxx）查询用户；邀请流程（T-2）使用。 */
export async function findByUid(
  uid: string,
  client: DbClient = db,
): Promise<User | null> {
  const [row] = await client.select().from(users).where(eq(users.uid, uid)).limit(1);
  return row ? toUser(row) : null;
}

/** 登录凭据：领域 User + 仅供 auth service 使用的密码哈希。 */
export interface UserCredentials {
  user: User;
  passwordHash: string;
}

/** 按用户名读取登录凭据；不存在返回 null。 */
export async function getCredentialsByUsername(
  username: string,
  client: DbClient = db,
): Promise<UserCredentials | null> {
  const [row] = await client
    .select()
    .from(users)
    .where(eq(users.username, username))
    .limit(1);

  if (!row) return null;
  return { user: toUser(row), passwordHash: row.passwordHash };
}

/** 用户名是否已被占用（注册前置检查）。 */
export async function usernameExists(
  username: string,
  client: DbClient = db,
): Promise<boolean> {
  const [row] = await client
    .select({ id: users.id })
    .from(users)
    .where(eq(users.username, username))
    .limit(1);
  return Boolean(row);
}

/** 个人设置：提醒开关领域模型（可跨边界传递）。 */
export interface ReminderPrefs {
  dueSoonReminderEnabled: boolean;
  overdueReminderEnabled: boolean;
}

/** 只取提醒开关两列，避免把密码哈希等字段带出。 */
const reminderPrefsColumns = {
  dueSoonReminderEnabled: users.dueSoonReminderEnabled,
  overdueReminderEnabled: users.overdueReminderEnabled,
} as const;

/** 读取用户提醒偏好；用户不存在时抛错（个人设置在会话内必然对应真实用户）。 */
export async function getReminderPrefs(
  userId: string,
  client: DbClient = db,
): Promise<ReminderPrefs> {
  const [row] = await client
    .select(reminderPrefsColumns)
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  if (!row) throw new Error("user not found");
  return row;
}

/**
 * 读取用户界面语言（仅单列，不查整行）。
 * i18n 请求解析使用：领域 User（packages/types）不含 language，
 * 故不通过 toUser 映射，单独提供轻量查询。用户不存在返回 null。
 */
export async function getUserLanguage(
  userId: string,
  client: DbClient = db,
): Promise<AppLocale | null> {
  const [row] = await client
    .select({ language: users.language })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  return (row?.language as AppLocale | undefined) ?? null;
}

/**
 * 更新用户界面语言并返回持久化值（账号级偏好，语言切换 Server Action 使用）。
 * 调用方（action 层）负责先做合法性校验；用户不存在时抛 DomainError。
 */
export async function updateUserLanguage(
  input: { userId: string; language: AppLocale },
  client: DbClient = db,
): Promise<AppLocale> {
  const [row] = await client
    .update(users)
    .set({ language: input.language })
    .where(eq(users.id, input.userId))
    .returning({ language: users.language });

  if (!row) throw new DomainError("user not found");
  return row.language as AppLocale;
}

/**
 * 部分更新提醒偏好：只写显式传入的键，未传的列保持库中原值；
 * 返回更新后的全量偏好。用户不存在时抛错。
 */
export async function updateReminderPrefs(
  input: {
    userId: string;
    dueSoonReminderEnabled?: boolean;
    overdueReminderEnabled?: boolean;
  },
  client: DbClient = db,
): Promise<ReminderPrefs> {
  const patch: Partial<ReminderPrefs> = {};
  if (input.dueSoonReminderEnabled !== undefined) {
    patch.dueSoonReminderEnabled = input.dueSoonReminderEnabled;
  }
  if (input.overdueReminderEnabled !== undefined) {
    patch.overdueReminderEnabled = input.overdueReminderEnabled;
  }

  // 没有任何键需要更新：不执行空 SET，直接返回当前值（仍校验用户存在）。
  if (Object.keys(patch).length === 0) {
    return getReminderPrefs(input.userId, client);
  }

  const [row] = await client
    .update(users)
    .set(patch)
    .where(eq(users.id, input.userId))
    .returning(reminderPrefsColumns);

  if (!row) throw new Error("user not found");
  return row;
}

/** 个人资料错误可落到的表单字段。 */
export type UserErrorField = "nickname" | "gender" | "email" | "phone" | "form";

/**
 * 个人资料领域错误。
 *
 * 与 AuthError 同构：`message` 是 zh 兜底，`field` 供 Server Action 映射为
 * 表单字段错误，`i18n` 携带 `{ key, params }` 供 action 按请求语言翻译
 * （key 位于 `users.profile.*` 命名空间）。数据库细节不向客户端泄露。
 */
export class UserError extends Error {
  readonly field: UserErrorField;
  readonly i18n?: DomainErrorI18n;

  constructor(
    message: string,
    field: UserErrorField = "form",
    i18n?: DomainErrorI18n,
  ) {
    super(message);
    this.name = "UserError";
    this.field = field;
    this.i18n = i18n;
  }
}

/** 个人资料领域模型（可跨边界传递）：null 表示未填写。 */
export interface UserProfile {
  nickname: string | null;
  gender: Gender | null;
  email: string | null;
  phone: string | null;
}

/** 只取四个可选资料列，避免把密码哈希等字段带出。 */
const profileColumns = {
  nickname: users.nickname,
  gender: users.gender,
  email: users.email,
  phone: users.phone,
} as const;

/** 可选文本字段：非字符串视为未填，统一 trim。 */
function normalizeOptionalText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function isGender(value: string): value is Gender {
  return value === "male" || value === "female" || value === "secret";
}

/**
 * 读取用户个人资料；用户不存在时抛 UserError（个人设置在会话内必然对应真实用户）。
 */
export async function getProfile(
  userId: string,
  client: DbClient = db,
): Promise<UserProfile> {
  const [row] = await client
    .select(profileColumns)
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  if (!row) throw new UserError("user not found");
  return row;
}

/**
 * 校验并归一化需要写入的资料列。
 *
 * 契约（表单是唯一写入口）：
 * - `nickname`：未传/`null`/空字符串 → **保持当前昵称**（不清空、不重新生成）；
 *   非空则 trim 并校验长度 ≤50。
 * - `gender` / `email` / `phone`：未传 → 保持当前值；显式 `null` 或空字符串
 *   → 清空为 null；非空则 trim 后按枚举 / 邮箱 / 电话规则校验（邮箱小写）。
 */
function buildProfilePatch(input: Partial<UserProfile>): Partial<UserProfile> {
  const patch: Partial<UserProfile> = {};

  if (input.nickname !== undefined && input.nickname !== null) {
    const nickname = normalizeOptionalText(input.nickname);
    if (nickname.length > NICKNAME_MAX_LENGTH) {
      throw new UserError(
        `昵称最多 ${NICKNAME_MAX_LENGTH} 个字符`,
        "nickname",
        { key: "nicknameMaxLength", params: { max: NICKNAME_MAX_LENGTH } },
      );
    }
    if (nickname) patch.nickname = nickname;
  }

  if (input.gender !== undefined) {
    const gender = normalizeOptionalText(input.gender);
    if (!gender) {
      patch.gender = null;
    } else if (!isGender(gender)) {
      throw new UserError("性别取值不合法", "gender", { key: "genderInvalid" });
    } else {
      patch.gender = gender;
    }
  }

  if (input.email !== undefined) {
    const email = normalizeOptionalText(input.email).toLowerCase();
    if (!email) {
      patch.email = null;
    } else if (!EMAIL_PATTERN.test(email)) {
      throw new UserError("邮箱格式不正确", "email", { key: "emailInvalid" });
    } else {
      patch.email = email;
    }
  }

  if (input.phone !== undefined) {
    const phone = normalizeOptionalText(input.phone);
    if (!phone) {
      patch.phone = null;
    } else if (!PHONE_PATTERN.test(phone)) {
      throw new UserError("手机号格式不正确", "phone", { key: "phoneInvalid" });
    } else {
      patch.phone = phone;
    }
  }

  return patch;
}

/**
 * 更新用户个人资料并返回持久化值（只允许改当前会话用户自己的资料）。
 *
 * - 未传任何键：不执行空 SET，直接返回当前值；
 * - 邮箱 / 电话冲突按唯一索引名分派为 `emailTaken` / `phoneTaken` 字段错误；
 * - 写入后直接返回持久化值（`returning`），保证返回值与落库一致。
 */
export async function updateProfile(
  input: { userId: string } & Partial<UserProfile>,
  client: DbClient = db,
): Promise<UserProfile> {
  const patch = buildProfilePatch(input);
  if (Object.keys(patch).length === 0) {
    return getProfile(input.userId, client);
  }

  try {
    const [row] = await client
      .update(users)
      .set(patch)
      .where(eq(users.id, input.userId))
      .returning(profileColumns);

    if (!row) throw new UserError("user not found");
    return row;
  } catch (error) {
    if (isUniqueViolation(error)) {
      const key = uniqueViolationKey(error);
      if (key === "users_email_unique") {
        throw new UserError("邮箱已被使用", "email", { key: "emailTaken" });
      }
      if (key === "users_phone_unique") {
        throw new UserError("手机号已被使用", "phone", { key: "phoneTaken" });
      }
    }
    throw error;
  }
}
