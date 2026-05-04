import type { NextConfig } from "next";

// Derive the Supabase storage hostname from the env var
// so images from the self-hosted Supabase instance are allowed.
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "http://localhost:54321";
const supabaseHostname = new URL(supabaseUrl).hostname;

const nextConfig: NextConfig = {
  // NB: `output: "standalone"` намеренно НЕ выставлен. Coolify запускает
  // приложение через `pnpm start` (= `next start`), а в стандaлон-режиме
  // Next.js явно warning'ует «does not work with output: standalone» —
  // нужен `node .next/standalone/server.js` с ручным копированием
  // .next/static и public/. Это давало разный chunk-resolution на
  // каждый request (наблюдалось ReferenceError: window is not defined
  // в server-чанках при некоторых route'ах). Убрали standalone — теперь
  // обычный `.next/` build, который полностью совместим с `next start`.
  images: {
    remotePatterns: [
      // Self-hosted Supabase storage (production)
      { protocol: "https", hostname: supabaseHostname },
      // Local Supabase dev instance
      { protocol: "http",  hostname: "localhost" },
      { protocol: "http",  hostname: "127.0.0.1" },
      // Common OAuth avatar providers
      { protocol: "https", hostname: "lh3.googleusercontent.com" },
      { protocol: "https", hostname: "avatars.githubusercontent.com" },
    ],
  },
  async redirects() {
    // 301-redirects from pre-block-restructure URLs to the new
    // block-namespaced paths (docs/MERGE_PLAN.md §6 Этап 1).
    // Remove these once external bookmarks and search index have
    // refreshed (~2 weeks after deployment).
    return [
      { source: "/staff",                    destination: "/people/staff",  permanent: true },
      { source: "/staff/:path*",             destination: "/people/staff/:path*", permanent: true },
      { source: "/settings/roles",           destination: "/people/roles",  permanent: true },
      { source: "/settings/roles/:path*",    destination: "/people/roles/:path*",  permanent: true },
      { source: "/settings/venues",          destination: "/org/venues",    permanent: true },
      { source: "/settings/venues/:path*",   destination: "/org/venues/:path*",    permanent: true },
      { source: "/settings/account",         destination: "/org/account",   permanent: true },
      { source: "/settings/profile",         destination: "/profile",       permanent: true },
    ];
  },
};

export default nextConfig;
