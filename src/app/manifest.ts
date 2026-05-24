import type { MetadataRoute } from "next";

/**
 * Web App Manifest — нужен для установки PWA (особенно «На экран Домой»
 * на iOS, где Web Push работает только из установленного PWA) и для
 * установимости в desktop Chrome. Next.js отдаёт его как
 * /manifest.webmanifest и сам добавляет <link rel="manifest">.
 *
 * Иконки пока SVG (desktop/Android принимают). Растровые PNG-иконки
 * (192/512/maskable + apple-touch) добавим на стадии iOS.
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
      {
        src: "/icon.svg",
        sizes: "any",
        type: "image/svg+xml",
        purpose: "any",
      },
    ],
  };
}
