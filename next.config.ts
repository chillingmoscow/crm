import type { NextConfig } from "next";

// Derive the Supabase storage hostname from the env var
// so images from the self-hosted Supabase instance are allowed.
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "http://localhost:54321";
const supabaseHostname = new URL(supabaseUrl).hostname;

const nextConfig: NextConfig = {
  // Skip type-check + ESLint во время `next build`. Оба гоняем
  // локально перед push'ем (`pnpm exec tsc --noEmit`, `pnpm lint`).
  // На прод-build они второй раз — а Coolify-контейнер ограничен
  // по памяти и tsc часто OOM-килится (видно в build-логе: build
  // умирает через ~10 сек после `Linting and checking validity of
  // types...`). Без этих флагов deploy неустойчиво ронялся 2-3 раза
  // подряд. Качество кода контролируем pre-push.
  typescript: {
    ignoreBuildErrors: true,
  },
  eslint: {
    ignoreDuringBuilds: true,
  },
  experimental: {
    serverActions: {
      // Next.js server actions имеют дефолт 1 МБ для тела запроса
      // (https://nextjs.org/docs/app/api-reference/functions/server-actions
      //   #size-limitation). KB-аплоады (uploadKbAttachment) — server
      // action, и любой файл >1 МБ молча режется ДО того как доходит
      // до Supabase. Юзер репортил «mp3 5.7 МБ не загружается, ogg/m4a
      // проходят» — те, что прошли, видимо были <1 МБ.
      // Поднимаем до 50 МБ, чтобы совпадало с storage.file_size_limit
      // в supabase/config.toml (50 MiB) и hint'ом в KB-FilePanel.
      bodySizeLimit: "50mb",
    },
  },
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
