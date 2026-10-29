/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  images: {
    // Only Unsplash, and only if the team fills image slots from there.
    // Health data never reaches a third party; see docs/ARCHITECTURE.md.
    remotePatterns: [
      { protocol: "https", hostname: "images.unsplash.com" },
    ],
    formats: ["image/avif", "image/webp"],
  },
  // Proxy to the FastAPI backend, but ONLY when one is configured.
  //
  // This is an afterFiles rewrite (a bare array), so it never shadows this
  // app's own handlers — /api/chat and /api/transcribe resolve first and are
  // the only API routes anything actually calls today.
  //
  // The default used to be http://localhost:8000. On a deployed host that is
  // the deployment itself, so every unmatched /api/* request became a hang
  // against a port nothing is listening on. Unset means no rewrite at all,
  // which fails as a plain 404 instead.
  async rewrites() {
    const backend = process.env.BACKEND_URL;
    if (!backend) return [];
    return [{ source: "/api/:path*", destination: `${backend}/:path*` }];
  },
};

export default nextConfig;
