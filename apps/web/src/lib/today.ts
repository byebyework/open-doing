/** 个人空间统一使用的时区。 */
const PERSONAL_TIME_ZONE = "Asia/Shanghai";

/**
 * 返回 Asia/Shanghai 时区下的「今天」，格式 `YYYY-MM-DD`。
 *
 * `en-CA` locale 的日期格式恰为 ISO 日期；显式指定时区，
 * 保证服务器运行在任意 TZ 下得到一致的截止日期判定基准。
 */
export function todayInShanghai(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: PERSONAL_TIME_ZONE,
  }).format(new Date());
}
