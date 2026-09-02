import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  // 允许通过 127.0.0.1 访问 dev server（否则 JS chunks/HMR 被视为跨域被拦截，页面无交互）
  allowedDevOrigins: ["127.0.0.1"],
};

export default nextConfig;
