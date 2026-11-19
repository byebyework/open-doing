/**
 * 标签限长常量唯一来源（客户端安全，同 projects/constants.ts 模式）。
 * 服务端校验器在 service.ts（server-only），常量经重导出兼容引用。
 */

/** 标签名最大长度 */
export const TAG_NAME_MAX_LENGTH = 20;

/** 每个空间（团队 / 个人）标签池的标签数上限 */
export const TAGS_PER_SPACE_LIMIT = 50;
