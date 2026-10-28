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
  async redirects() {
    return [
      { source: "/my", destination: "/space/personal/dashboard", permanent: false },
      { source: "/my/:path*", destination: "/space/personal/:path*", permanent: false },
      // 负向前瞻排除静态页，避免 /teams/new、/teams/join 被当团队 slug 重定向。
      // Next 16 内置 path-to-regexp 不接受 `(?!...)` 直接作参数模式，需写成
      // 完整段模式 `((?!(?:new|join)(?:/|$))[^/]+)`，语义等价。
      { source: "/teams/:slug((?!(?:new|join)(?:/|$))[^/]+)", destination: "/space/:slug/dashboard", permanent: false },
      { source: "/teams/:slug((?!(?:new|join)(?:/|$))[^/]+)/:path*", destination: "/space/:slug/:path*", permanent: false },
    ];
  },
};

export default nextConfig;
