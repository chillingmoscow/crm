/**
 * Правило обязательного чтения в одном месте (миграция 416): прочтение
 * действует, пока менеджер не попросил перечитать версию новее
 * прочитанной. Правки страницы сами прочтение не сбрасывают.
 *
 * То же сравнение — в SQL (`kb_get_page_view_data`,
 * `kb_list_required_reading_stats`, `kb_required_reading_overview`).
 */

export type KbReadingStatus = "read" | "reread" | "unread";

/** `readVersion` — версия, на которой человек подтвердил прочтение
 *  (последняя его отметка); `rereadFromVersion` — порог «перечитать,
 *  начиная с версии» у страницы, `null` — никто не просил. */
export function kbReadIsCurrent(
  readVersion: number | null,
  rereadFromVersion: number | null,
): boolean {
  return readVersion !== null && readVersion >= (rereadFromVersion ?? 1);
}

export function kbReadingStatus(
  readVersion: number | null,
  rereadFromVersion: number | null,
): KbReadingStatus {
  if (readVersion === null) return "unread";
  return kbReadIsCurrent(readVersion, rereadFromVersion) ? "read" : "reread";
}
