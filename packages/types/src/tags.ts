/**
 * 标签（空间级标签池）共享类型与纯函数。
 *
 * 标签属于空间（团队或个人）而非项目：团队空间一套标签池，个人空间一套；
 * 任务通过 task_tags 关联表多选打标。颜色为预设色板 key，运行时映射到
 * `apps/web/src/app/tokens.css` 的同名 token 变量（见 features/tags/components/tag-colors）。
 */

/** 预设色板 key 全集（与 tokens.css 的品牌紫 + 5 个 accent 色一一对应） */
export const TAG_COLORS = [
  "purple",
  "coral",
  "tangerine",
  "mint",
  "sky",
  "lavender",
] as const;

/** 标签颜色：预设色板 key */
export type TagColor = (typeof TAG_COLORS)[number];

/** 标签类型全集：项目标签（打在项目上）与任务标签（打在任务上） */
export const TAG_TYPES = ["project", "task"] as const;

/** 标签类型：创建时定型，不可兼任 */
export type TagType = (typeof TAG_TYPES)[number];

/** 判定任意值是否为合法标签类型 */
export function isTagType(value: unknown): value is TagType {
  return typeof value === "string" && (TAG_TYPES as readonly string[]).includes(value);
}

/** 判定任意值是否为合法色板 key（服务层校验与客户端防御共用） */
export function isTagColor(value: unknown): value is TagColor {
  return (
    typeof value === "string" &&
    (TAG_COLORS as readonly string[]).includes(value)
  );
}

/** 标签：空间级标签池成员；teamId / ownerId 二选一（数据库 CHECK 兜底） */
export interface Tag {
  id: string;
  /** 团队标签所属团队；个人标签为 null */
  teamId: string | null;
  /** 个人标签归属用户；团队标签为 null */
  ownerId: string | null;
  name: string;
  color: TagColor;
  /** 标签类型：创建时定型，不可兼任（任务打标只接受 task，项目打标只接受 project） */
  type: TagType;
  /** 可选描述：说明该标签的适用场景 */
  description?: string;
  /** ISO 字符串；创建时等于 createdAt，改名/换色/改描述时推进 */
  updatedAt: string;
  /** ISO 字符串 */
  createdAt: string;
}

/** 标签 + 使用计数（打了该标签的任务数；管理 UI 展示用） */
export interface TagWithUsage extends Tag {
  usageCount: number;
}
