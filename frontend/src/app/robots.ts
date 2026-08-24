// One crawlable page and one deploy smoke test. The smoke test is not content.
import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: "*", allow: "/", disallow: "/health-check" },
  };
}
