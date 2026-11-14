/**
 * 认证校验规则常量（客户端表单与服务端共用）。
 *
 * 本文件必须保持无副作用、无 Node 依赖，避免客户端组件
 * 通过它把数据库 / better-auth 等服务端模块打进浏览器包。
 */

/** 用户名长度：2–20 个字符（brief 冻结规则）。 */
export const USERNAME_MIN_LENGTH = 2;
export const USERNAME_MAX_LENGTH = 20;

/**
 * 用户名字符集：ASCII 字母 / 数字 / 下划线（2026-11-14 追加）。
 *
 * 帐号仅用于登录，不允许中文（含其他非 ASCII 字符）；展示名（昵称）
 * 不受此限制。登录侧不校验字符集——存量中文帐号仍可正常登录。
 */
export const USERNAME_PATTERN = /^[A-Za-z0-9_]+$/;

/** 密码最短 8 位。 */
export const PASSWORD_MIN_LENGTH = 8;

/** 昵称最大长度（展示名写入 better-auth 的 users.name 列）。 */
export const NICKNAME_MAX_LENGTH = 50;

/** 可选资料格式：注册表单与服务端校验共用同一规则。 */
export const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const PHONE_PATTERN = /^[+\-0-9]{7,20}$/;

export const USERNAME_TAKEN_MESSAGE = "帐号已存在";
/** 登录失败恒定文案：不区分“用户不存在”与“密码错误”，避免枚举用户名。 */
export const INVALID_CREDENTIALS_MESSAGE = "帐号或密码错误";
