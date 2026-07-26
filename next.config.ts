import type { NextConfig } from "next";

const isDev = process.env.NODE_ENV !== "production";

// Next.js Fast Refresh needs 'unsafe-eval' + an HMR websocket in development.
// Production stays locked down (no eval, no ws).
const csp = [
  "default-src 'self'",
  "img-src 'self' https://image.tmdb.org data: blob:",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  `connect-src 'self'${isDev ? " ws: wss:" : ""}`,
  "font-src 'self' data:",
  // YouTube trailer embeds (privacy-enhanced domain).
  "frame-src https://www.youtube-nocookie.com https://www.youtube.com",
  "frame-ancestors 'none'",
  "object-src 'none'",
  "base-uri 'self'",
].join("; ");

// Security headers applied to every response (see global security standards).
const securityHeaders = [
  { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "geolocation=(), microphone=(), camera=(), payment=()" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Cross-Origin-Resource-Policy", value: "same-origin" },
  { key: "Content-Security-Policy", value: csp },
];

const nextConfig: NextConfig = {
  // Do not leak the framework or ship source maps in production.
  poweredByHeader: false,
  productionBrowserSourceMaps: false,
  // No ESLint config is shipped; do not fail production builds on lint.
  eslint: { ignoreDuringBuilds: true },
  // Keep native/server-only deps external instead of bundling them.
  serverExternalPackages: ["bullmq", "ioredis"],
  images: {
    dangerouslyAllowSVG: false,
    remotePatterns: [{ protocol: "https", hostname: "image.tmdb.org" }],
  },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
