import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  allowedDevOrigins: [
    // `*` matches one subdomain label; workstation hosts have two
    "**.cloudworkstations.dev",
  ],
};

export default nextConfig;
