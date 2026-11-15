import { randomBytes } from "node:crypto";

/**
 * 入群码字符集：大写字母 + 数字，剔除易混淆的 I / L / O / 0 / 1。
 * 长度 31，与 256 不整除，需拒绝采样避免取模偏差。
 */
const ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
const JOIN_CODE_LENGTH = 8;

/**
 * 生成团队入群码：8 位大写字母数字（不含 I/L/O/0/1），31⁸ ≈ 8.5×10¹¹ 不可枚举。
 *
 * 与 `uid.ts` 的 generateUid 同族：同一 node:crypto + 拒绝采样骨架。
 * 区别在于：入群码需要人工口头转述/手抄，故用大写并去掉 `doing_` 前缀；
 * 大写无前缀也不影响唯一性——入群码在 teams 表中独立查重。
 */
export function generateJoinCode(): string {
  const chars: string[] = [];

  while (chars.length < JOIN_CODE_LENGTH) {
    const bytes = randomBytes(JOIN_CODE_LENGTH * 2);
    for (const byte of bytes) {
      // 丢弃会导致取模偏差的高位字节。
      if (byte >= 256 - (256 % ALPHABET.length)) continue;
      chars.push(ALPHABET[byte % ALPHABET.length]!);
      if (chars.length === JOIN_CODE_LENGTH) break;
    }
  }

  return chars.join("");
}
