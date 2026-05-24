import { renderAppIcon } from "@/lib/icons";

// apple-touch-icon для iOS «На экран Домой». 180×180 — рекомендуемый
// размер. Next автоматически вставляет <link rel="apple-touch-icon">.
export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  return renderAppIcon(180);
}
