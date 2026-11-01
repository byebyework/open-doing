import type { AppConfig } from "next-intl";

import type { AppLocale } from "./config";

// next-intl 全局类型:Locale 收敛为 AppLocale,zh.json 是 key 的唯一权威
// (messages-parity 测试保证 en.json 与其 key 集合一致)。
declare module "next-intl" {
  interface AppConfig {
    Locale: AppLocale;
    Messages: typeof import("./messages/zh.json");
  }
}
