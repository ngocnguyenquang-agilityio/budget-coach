import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: [
    "@duckdb/node-api",
    "@duckdb/node-bindings",
    "@mastra/duckdb",
  ],
};

export default nextConfig;
