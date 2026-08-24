import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The header advertises the framework and buys nothing back.
  poweredByHeader: false,
  // A build that type-errors must fail here rather than ship. It is the default, and
  // it is written down so a future "just get it deployed" cannot quietly flip it.
  // (`eslint` is no longer a next.config key in 16 — lint runs from `npm run lint`.)
  typescript: { ignoreBuildErrors: false },
};

export default nextConfig;
