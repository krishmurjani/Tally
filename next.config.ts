import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  typedRoutes: false,
  // Don't let `next dev` write AGENTS.md into the repo.
  agentRules: false,
};

export default nextConfig;
