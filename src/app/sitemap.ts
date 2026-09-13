import type { MetadataRoute } from "next";
import { listListings, topBuilders } from "@/lib/db";
import { SITE_URL } from "@/lib/site";

// Reads the index on every request, so a new listing is discoverable as soon as it is live.
export const dynamic = "force-dynamic";

/**
 * Every public page, plus one entry per live listing and per builder with a track record.
 * The listing pages are where the value is for search: a token's name and symbol are on
 * them, and that is what someone who already knows the coin will type.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();
  const fixed: MetadataRoute.Sitemap = [
    { url: `${SITE_URL}/`, lastModified: now, changeFrequency: "hourly", priority: 1 },
    { url: `${SITE_URL}/how-it-works`, lastModified: now, changeFrequency: "monthly", priority: 0.8 },
    { url: `${SITE_URL}/sell`, lastModified: now, changeFrequency: "monthly", priority: 0.7 },
    { url: `${SITE_URL}/wanted`, lastModified: now, changeFrequency: "daily", priority: 0.6 },
  ];

  let listings: MetadataRoute.Sitemap = [];
  let builders: MetadataRoute.Sitemap = [];
  try {
    listings = listListings({ status: "active" }).map((l) => ({
      url: `${SITE_URL}/listings/${l.id}`,
      lastModified: new Date(l.updatedAt),
      changeFrequency: "daily" as const,
      priority: 0.9,
    }));
    builders = topBuilders(200).map((b) => ({
      url: `${SITE_URL}/builders/${b.wallet}`,
      lastModified: b.profile ? new Date(b.profile.updatedAt) : now,
      changeFrequency: "weekly" as const,
      priority: 0.5,
    }));
  } catch {
    // A sitemap that lists only the fixed pages beats one that fails; the index is
    // presentation, and a database hiccup should not make the whole site look empty.
  }

  return [...fixed, ...listings, ...builders];
}
