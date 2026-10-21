import type { NextConfig } from "next";

const isElectron = process.env.BUILD_FOR_ELECTRON === "1";

const nextConfig: NextConfig = {
  // build untuk web sandbox: standalone; build untuk Electron: export statik
  output: isElectron ? "export" : "standalone",
  // path relatif (./_next/…) supaya asset termuat di protokol file:// & app://
  // Electron (bug layar hitam: path absolut /_next/ rusak di file://)
  ...(isElectron ? { assetPrefix: "./" } : {}),
  images: { unoptimized: true },
  typescript: {
    ignoreBuildErrors: true,
  },
  reactStrictMode: false,
  // mp4-muxer & engine client-side tidak butuh transformasi khusus
};

export default nextConfig;
