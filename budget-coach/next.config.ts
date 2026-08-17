import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["@copilotkit/runtime", "@libsql/client", "libsql"],
  typescript: {
    // @mastra/memory beta packages have unstable types that break strict checking
    ignoreBuildErrors: true,
  },
};

export default nextConfig;
