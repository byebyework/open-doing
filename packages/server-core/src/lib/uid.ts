import { randomBytes } from "node:crypto";

/**
 * UID 字符集：小写字母 + 数字，剔除易混淆的 i / l / o / 0 / 1。
 * 长度 31，与 256 不整除，需拒绝采样避免取模偏差。
 */
const ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";
const UID_LENGTH = 6;
const UID_PREFIX = "doing_";

/**
 * 生成对外 UID：`doing_` + 6 位小写字母数字（不含 i/l/o/0/1）。
 *
 * 随机源为 node:crypto，配合拒绝采样保证字符分布均匀、不可枚举。
 */
export function generateUid(): string {
  const chars: string[] = [];

  while (chars.length < UID_LENGTH) {
    const bytes = randomBytes(UID_LENGTH * 2);
    for (const byte of bytes) {
      // 丢弃会导致取模偏差的高位字节。
      if (byte >= 256 - (256 % ALPHABET.length)) continue;
      chars.push(ALPHABET[byte % ALPHABET.length]!);
      if (chars.length === UID_LENGTH) break;
    }
  }

  return `${UID_PREFIX}${chars.join("")}`;
}
