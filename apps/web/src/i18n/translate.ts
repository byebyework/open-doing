import type zh from "./messages/zh.json";

/** zh.json 的结构类型(en.json 由 messages-parity 测试保证同构)。 */
export type AppMessages = typeof zh;

/**
 * 消息树的节点：字符串叶子，或对象/数组容器。
 *
 * 数组用于 legal 文档的分节结构（只经 next-intl `raw()` 整体读取，
 * 不参与 createTranslator 的点号取词）。
 */
type MessageNode = string | MessageTree | MessageNode[];

/** 任意深度的消息树(接受 zh.json,也接受测试夹具等子集)。 */
export type MessageTree = { [key: string]: MessageNode };

/** 轻量取词函数:点号路径 + {name} 插值。 */
export type TranslateFn = (
  key: string,
  values?: Record<string, string | number>,
) => string;

/**
 * 服务端轻量 translator:同一份 messages JSON,不依赖 next-intl 的
 * 请求上下文(Server Action / vitest / cron 均可用)。缺 key 立即抛错,
 * 让漏翻在测试期暴露而不是渲染出空串。
 */
export function createTranslator(messages: MessageTree): TranslateFn {
  return (key, values) => {
    let node: unknown = messages;
    for (const segment of key.split(".")) {
      if (node === null || typeof node !== "object" || !(segment in node)) {
        throw new Error(`[i18n] missing key: ${key}`);
      }
      node = (node as Record<string, unknown>)[segment];
    }

    if (typeof node !== "string") {
      throw new Error(`[i18n] value for ${key} is not a string`);
    }

    if (!values) return node;

    return node.replace(/\{(\w+)\}/g, (match, name: string) => {
      const value = values[name];
      return value === undefined ? match : String(value);
    });
  };
}
