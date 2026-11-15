import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  typedRoutes: false,
  // Don't let `next dev` write AGENTS.md into the repo.
  agentRules: false,
  experimental: {
    // CSV import uploads several Splitwise exports at once. Vercel caps request bodies at 4.5 MB.
    serverActions: { bodySizeLimit: "4mb" },
  },
};

export default nextConfig;
