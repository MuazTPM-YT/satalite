// One crawlable page. The health check is a deploy smoke test, not content, and
// robots.ts already disallows it — a sitemap that listed it would be asking a crawler
// to index the thing the robots file just told it to skip.
import type { MetadataRoute } from "next";

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    {
      url: SITE_URL,
      lastModified: new Date(),
      changeFrequency: "weekly",
      priority: 1,
    },
  ];
}
