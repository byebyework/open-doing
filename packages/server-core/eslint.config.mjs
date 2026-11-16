// 与 web 共用同一套 flat config（next core-web-vitals + typescript 规则）。
// 本包不是 Next 应用：关闭只针对 pages 目录的 next 规则并固定 React 版本，
// 避免 eslint-plugin-next / eslint-plugin-react 输出与本包无关的告警。
import shared from "../../apps/web/eslint.config.mjs";

export default [
  ...shared,
  {
    settings: { react: { version: "19.3.0" } },
    rules: { "@next/next/no-html-link-for-pages": "off" },
  },
];
