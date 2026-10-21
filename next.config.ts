import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // build untuk web sandbox: standalone; build untuk Electron: export statik
  output: process.env.BUILD_FOR_ELECTRON === "1" ? "export" : "standalone",
  images: { unoptimized: true },
  typescript: {
    ignoreBuildErrors: true,
  },
  reactStrictMode: false,
  // mp4-muxer & engine client-side tidak butuh transformasi khusus
};

export default nextConfig;
