import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["@copilotkit/runtime", "@libsql/client", "libsql"],
  env: {
    NEXT_PUBLIC_COPILOTKIT_THREADS_ENABLED: process.env.COPILOTKIT_LICENSE_TOKEN
      ? "true"
      : "false",
  },
  typescript: {
    // @mastra/memory beta packages have unstable types that break strict checking
    ignoreBuildErrors: true,
  },
};

export default nextConfig;
