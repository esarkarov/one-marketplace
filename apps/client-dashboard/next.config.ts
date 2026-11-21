import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@onemarketplace/api-client", "@onemarketplace/web-core"],
};

export default nextConfig;
