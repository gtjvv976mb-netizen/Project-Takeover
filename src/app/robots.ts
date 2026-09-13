import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/site";

/**
 * Crawlers may index everything a visitor can see. The API is JSON for the site's own
 * use and the dashboard is per-wallet, so neither belongs in a search result.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: "*", allow: "/", disallow: ["/api/", "/dashboard"] },
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
