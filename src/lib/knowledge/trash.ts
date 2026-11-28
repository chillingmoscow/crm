/**
 * Корзина базы знаний: группы по давности удаления и поиск по названию.
 * Группы считаются по местному дню браузера, как и было.
 */
export type KbTrashBucket = "today" | "yesterday" | "week" | "earlier";

export const KB_TRASH_BUCKET_ORDER: KbTrashBucket[] = ["today", "yesterday", "week", "earlier"];

export const KB_TRASH_BUCKET_LABEL: Record<KbTrashBucket, string> = {
  today: "Сегодня",
  yesterday: "Вчера",
  week: "На прошлой неделе",
  earlier: "Ранее",
};

const DAY_MS = 24 * 60 * 60 * 1000;

function startOfDay(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

export function kbTrashBucket(deletedAt: string | null, now: Date = new Date()): KbTrashBucket {
  if (!deletedAt) return "earlier";
  const days = Math.round((startOfDay(now) - startOfDay(new Date(deletedAt))) / DAY_MS);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days <= 7) return "week";
  return "earlier";
}

const normalize = (text: string) => text.toLocaleLowerCase("ru").replace(/ё/g, "е").trim();

export function kbTrashMatches(title: string | null, query: string): boolean {
  const q = normalize(query);
  if (!q) return true;
  return title !== null && normalize(title).includes(q);
}
