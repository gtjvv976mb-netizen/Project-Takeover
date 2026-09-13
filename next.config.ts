import type { NextConfig } from "next";
import path from "node:path";

/**
 * Headers every response carries. No Content-Security-Policy yet: the wallet adapter and
 * the theme script both rely on inline code, so a policy tight enough to be worth having
 * needs nonces threaded through the layout first. That is tracked in LAUNCH.md.
 */
const securityHeaders = [
  // Render terminates TLS and the site is only ever served over HTTPS, so pin it.
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
  // Nothing here needs to be framed, and a framed wallet prompt is how clickjacking starts.
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
];

const nextConfig: NextConfig = {
  turbopack: { root: path.resolve(__dirname) },
  // Advertising the framework buys nothing and narrows an attacker's search.
  poweredByHeader: false,
  headers() {
    return Promise.resolve([{ source: "/:path*", headers: securityHeaders }]);
  },
};

export default nextConfig;
