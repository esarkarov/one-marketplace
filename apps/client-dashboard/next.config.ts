import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@onemarketplace/api-client", "@onemarketplace/web-core"],
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "img.clerk.com" },
      { protocol: "https", hostname: "ik.imagekit.io" },
    ],
  },
};

export default nextConfig;
