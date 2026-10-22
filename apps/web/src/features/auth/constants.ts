/**
 * 认证校验规则常量（客户端表单与服务端共用）。
 *
 * 本文件必须保持无副作用、无 Node 依赖，避免客户端组件
 * 通过它把数据库 / argon2 等服务端模块打进浏览器包。
 */

/** 用户名长度：2–20 个字符（brief 冻结规则）。 */
export const USERNAME_MIN_LENGTH = 2;
export const USERNAME_MAX_LENGTH = 20;

/** 密码最短 8 位。 */
export const PASSWORD_MIN_LENGTH = 8;

export const USERNAME_TAKEN_MESSAGE = "用户名已存在";
/** 登录失败恒定文案：不区分“用户不存在”与“密码错误”，避免枚举用户名。 */
export const INVALID_CREDENTIALS_MESSAGE = "用户名或密码错误";
