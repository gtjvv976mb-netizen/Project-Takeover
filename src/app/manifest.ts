import type { MetadataRoute } from "next";

/**
 * What lets a phone treat the site as an app.
 *
 * On iOS there is no install prompt and no store listing here: a visitor taps Share →
 * Add to Home Screen, and from then on the site opens full-screen from its own icon,
 * with the browser chrome gone. That is what `display: standalone` and the icons buy.
 * The same manifest makes Android and desktop Chrome offer a proper install.
 *
 * The icons are PNG on purpose. iOS ignores SVG for the home-screen tile, and every
 * launcher crops a "maskable" icon to its own shape, so the mark sits inside a solid
 * slate tile with room around it rather than filling the frame.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Project: Takeover",
    short_name: "Takeover",
    description: "You dream it. Devs build it. Hire a Solana developer, or sell what you shipped — with the money in escrow until the work lands.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#0B0F17",
    theme_color: "#0B0F17",
    categories: ["business", "finance", "productivity"],
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
