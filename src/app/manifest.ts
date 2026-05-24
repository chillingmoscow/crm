import type { MetadataRoute } from "next";

/**
 * Web App Manifest — нужен для установки PWA (особенно «На экран Домой»
 * на iOS, где Web Push работает только из установленного PWA) и для
 * установимости в desktop Chrome. Next.js отдаёт его как
 * /manifest.webmanifest и сам добавляет <link rel="manifest">.
 *
 * Иконки: SVG (any) + растровые PNG 192/512 (any) и 512 maskable
 * (Android adaptive) — PNG генерятся next/og через /api/icons/*.
 * apple-touch-icon для iOS отдаётся отдельно из app/apple-icon.tsx.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Sheerly",
    short_name: "Sheerly",
    description: "Корпоративная платформа управления заведениями",
    start_url: "/",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: "#ffffff",
    lang: "ru",
    icons: [
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
      { src: "/api/icons/192", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/api/icons/512", sizes: "512x512", type: "image/png", purpose: "any" },
      {
        src: "/api/icons/maskable",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
