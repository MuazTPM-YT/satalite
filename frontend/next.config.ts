import type { NextConfig } from "next";

// Headers that cost nothing and close the three things a static studio can actually
// be attacked through: MIME sniffing, being framed by somebody else's page, and
// leaking the full URL to a third party on an outbound link.
//
// No Content-Security-Policy here on purpose. The backend origin is a build-time
// variable, so a `connect-src` written in this file would either be wrong for every
// deployment that is not localhost or would have to be widened to `*` and mean
// nothing. It belongs on the edge/proxy that knows the real origins.
const SECURITY_HEADERS = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // The studio needs none of these. Denying them is what makes a permission prompt
  // from an embedded anything impossible rather than merely unlikely.
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), interest-cohort=()",
  },
];

const nextConfig: NextConfig = {
  // The header advertises the framework and buys nothing back.
  poweredByHeader: false,
  // A build that type-errors must fail here rather than ship. It is the default, and
  // it is written down so a future "just get it deployed" cannot quietly flip it.
  // (`eslint` is no longer a next.config key in 16 — lint runs from `npm run lint`.)
  typescript: { ignoreBuildErrors: false },
  // Nothing here is ever read by a person, and shipping them doubles the deploy.
  productionBrowserSourceMaps: false,
  async headers() {
    return [{ source: "/:path*", headers: SECURITY_HEADERS }];
  },
};

export default nextConfig;
