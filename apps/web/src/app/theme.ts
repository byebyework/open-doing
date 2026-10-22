import type { ThemeConfig } from "antd";

/**
 * Open Doing 设计令牌到 antd v6 主题的映射。
 *
 * 数值来源：docs/prototypes/README.md §"到 antd v6 ConfigProvider 的映射"
 * 原始三层令牌：docs/prototypes/assets/design-tokens.css
 * 品牌渐变不进 antd 主题，后续由业务组件通过 className 使用。
 */
export const antdTheme: ThemeConfig = {
  token: {
    // 品牌与语义色
    colorPrimary: "#7d2ae8",
    colorSuccess: "#00b894",
    colorWarning: "#ffb020",
    colorError: "#ff5757",
    colorInfo: "#0d99ff",

    // 表面与描边
    colorBgLayout: "#f4f5f7",
    colorBorder: "#c7cdd3",
    colorBorderSecondary: "#e1e3e6",

    // 圆角与控件高度
    borderRadius: 8,
    borderRadiusLG: 12,
    controlHeight: 38,

    // 字体与阴影
    fontFamily:
      '"Canva Sans","YS Text",system-ui,-apple-system,"PingFang SC","Microsoft YaHei",sans-serif',
    boxShadow: "0 1px 3px rgba(14,19,24,.04)",
    boxShadowSecondary: "0 8px 24px rgba(14,19,24,.08)",
  },
};
