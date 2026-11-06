/**
 * 个人资料校验规则常量（ProfileForm 与服务端 updateProfile 共用）。
 *
 * 与注册表单的规则保持一致（trim → 空=null、邮箱小写、电话 / 昵称格式），
 * 但按 users 领域的错误文案独立维护。本文件保持无副作用、无 Node 依赖，
 * 避免客户端组件把数据库等服务端模块打进浏览器包。
 */

/** 昵称最大长度（与 users.nickname 的 varchar(50) 一致）。 */
export const NICKNAME_MAX_LENGTH = 50;

/** 邮箱格式：与服务端 updateProfile 的校验一致。 */
export const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** 电话格式：仅允许数字与 + / -，7–20 个字符。 */
export const PHONE_PATTERN = /^[+\-0-9]{7,20}$/;

/** 性别单选的三个合法取值（与 packages/types 的 Gender 一致）。 */
export const GENDER_VALUES = ["male", "female", "secret"] as const;
