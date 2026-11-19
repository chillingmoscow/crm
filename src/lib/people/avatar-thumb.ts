/**
 * Уменьшенная копия фото человека для кружка в списках.
 *
 * Фото сотрудников хранятся оригиналами (0,4–2,3 МБ с телефона), а в списке
 * они нужны кружком 36px. Оригинал на каждый заход в «Сотрудников» или
 * «Расписание» — это мегабайты и заметная прорисовка. Копию 96px (≈2–3 КБ)
 * отдаёт оптимизатор картинок Next: он кэширует её у себя, а браузер — по
 * заголовкам исходника.
 *
 * Уменьшаются только публичные постоянные адреса: публичный бакет нашего
 * Supabase и выгрузки Glide. Подписанные ссылки (кандидаты) содержат время
 * выдачи — у них свой путь в `lib/candidates/data.ts`. Остальное — как есть.
 * Если копия не загрузится, `PersonAvatar` покажет оригинал.
 */
export const AVATAR_THUMB_WIDTH = 96;

function supabaseOrigin(): string | null {
  try {
    return new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").origin;
  } catch {
    return null;
  }
}

export function avatarThumbUrl(
  url: string | null | undefined,
  width: number = AVATAR_THUMB_WIDTH,
): string | null {
  if (!url) return null;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return url;
  }
  const supabasePublic =
    parsed.origin === supabaseOrigin() &&
    parsed.pathname.startsWith("/storage/v1/object/public/");
  const glide =
    parsed.protocol === "https:" &&
    parsed.hostname === "storage.googleapis.com" &&
    parsed.pathname.startsWith("/glide-prod.appspot.com/");
  if (!supabasePublic && !glide) return url;
  return `/_next/image?url=${encodeURIComponent(url)}&w=${width}&q=75`;
}
