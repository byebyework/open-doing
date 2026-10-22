import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@open-doing/types"],
  // 暂不启用 cacheComponents/partialPrefetching：
  // @ant-design/cssinjs 在 AntdRegistry 的 useState 初始化中调用 Math.random()，
  // 会被 Cache Components 的 prerender 校验判为不稳定值并导致构建失败。
  // antd 后续版本修复后可在 next.config.ts 中重新开启。
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
