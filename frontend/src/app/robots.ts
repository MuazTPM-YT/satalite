// One crawlable page and one deploy smoke test. The smoke test is not content.
import type { MetadataRoute } from "next";

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: "*", allow: "/", disallow: "/health-check" },
    // Absolute, because a crawler reads robots.txt before it knows the site's origin
    // from anything else.
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
