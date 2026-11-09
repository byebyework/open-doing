/**
 * better-auth APIError -> 表单字段 + `auth` 命名空间 i18n key 的映射表。
 *
 * 错误码来源（better-auth 1.7.18 安装包实证枚举）：
 * - `plugins/username/error-codes.mjs`：USERNAME_* / INVALID_USERNAME* /
 *   INVALID_USERNAME_OR_PASSWORD / EMAIL_NOT_VERIFIED；
 * - `@better-auth/core/dist/error/codes.mjs`：USER_ALREADY_EXISTS(_USE_ANOTHER_EMAIL)
 *   / INVALID_EMAIL / PASSWORD_TOO_SHORT / PASSWORD_TOO_LONG /
 *   INVALID_PASSWORD / EMAIL_PASSWORD_SIGN_UP_DISABLED 等；
 * - 注册钩子自定义令牌（hooks.ts）：REG_CODE_* / UID_COLLISION / PHONE_TAKEN。
 *
 * 未列入的错误一律返回 null，由调用方回落到 `auth.registerFailed`
 * 等通用文案；**绝不把 better-auth 的英文 message 透给用户**。
 * Task 3 的登录 / 改密可直接复用本表（INVALID_PASSWORD 在改密场景下
 * 可按需二次覆盖为 oldPassword/oldPasswordIncorrect）。
 */
import { PASSWORD_MIN_LENGTH } from "./constants";

export interface MappedAuthError {
  field: string;
  i18nKey: string;
  /** 模板插值参数（如 `{ min: 8 }`），随 i18nKey 一起传给 translator。 */
  params?: Record<string, string | number>;
}

/** 从 better-call APIError 中读取错误码；兼容 body.code 与 body.message。 */
export function readAuthErrorCode(error: unknown): string | null {
  if (!error || typeof error !== "object") return null;

  const body = (error as { body?: { code?: unknown; message?: unknown } }).body;
  if (body) {
    if (typeof body.code === "string" && body.code) return body.code;
    if (typeof body.message === "string" && body.message) return body.message;
  }

  const code = (error as { code?: unknown }).code;
  return typeof code === "string" && code ? code : null;
}

const ERROR_CODE_MAP: Record<string, MappedAuthError> = {
  // 用户名 / 邮箱 / 密码（sign-up email、sign-in username、change-password）
  USERNAME_IS_ALREADY_TAKEN: { field: "username", i18nKey: "usernameTaken" },
  USERNAME_TOO_SHORT: { field: "username", i18nKey: "usernameTooShort" },
  USERNAME_TOO_LONG: { field: "username", i18nKey: "usernameTooLong" },
  INVALID_USERNAME: { field: "username", i18nKey: "usernameInvalid" },
  INVALID_DISPLAY_USERNAME: { field: "username", i18nKey: "usernameInvalid" },
  USER_ALREADY_EXISTS: { field: "email", i18nKey: "emailTaken" },
  USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL: { field: "email", i18nKey: "emailTaken" },
  INVALID_EMAIL: { field: "email", i18nKey: "emailInvalid" },
  // 改密场景是 PASSWORD_TOO_SHORT 的首次可达路径：带最小长度参数，
  // 避免展示一条没有上下文的「密码太短」。
  PASSWORD_TOO_SHORT: {
    field: "password",
    i18nKey: "passwordMinLength",
    params: { min: PASSWORD_MIN_LENGTH },
  },
  PASSWORD_TOO_LONG: { field: "password", i18nKey: "passwordTooLong" },
  INVALID_PASSWORD: { field: "form", i18nKey: "invalidCredentials" },
  INVALID_USERNAME_OR_PASSWORD: { field: "form", i18nKey: "invalidCredentials" },
  EMAIL_NOT_VERIFIED: { field: "form", i18nKey: "emailNotVerified" },

  // 注册码 / UID / 手机号（hooks.ts 自定义令牌）
  REG_CODE_INVALID: { field: "registrationCode", i18nKey: "registrationCodeInvalid" },
  REG_CODE_EXHAUSTED: { field: "registrationCode", i18nKey: "registrationCodeExhausted" },
  UID_COLLISION: { field: "form", i18nKey: "uidGenerationFailed" },
  PHONE_TAKEN: { field: "phone", i18nKey: "phoneTaken" },

  // 兼容历史自研错误码（action 内部过渡期可能仍抛出）
  USERNAME_TAKEN: { field: "username", i18nKey: "usernameTaken" },
  EMAIL_TAKEN: { field: "email", i18nKey: "emailTaken" },
  REGISTRATION_CODE_INVALID: {
    field: "registrationCode",
    i18nKey: "registrationCodeInvalid",
  },
  REGISTRATION_CODE_EXHAUSTED: {
    field: "registrationCode",
    i18nKey: "registrationCodeExhausted",
  },
};

/**
 * 把 better-auth 的错误映射为字段错误；未知错误返回 null。
 *
 * 保持 async 签名，方便 Task 3 将来加入需要 IO 的判定（如按请求路径
 * 或数据库状态细分），且调用方始终 `await`。
 */
export async function mapAuthError(error: unknown): Promise<MappedAuthError | null> {
  const code = readAuthErrorCode(error);
  return code ? (ERROR_CODE_MAP[code] ?? null) : null;
}
