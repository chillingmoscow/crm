/** Среднее количество слов в минуту для русско/смешанного текста.
 *  Для чистого английского было бы ~250 wpm; русский плотнее, читается
 *  чуть медленнее (есть исследования Карповича и др. на ~180 wpm).
 *  Берём 180 как default — даёт реалистичную оценку для регламентов.
 *
 *  Не делаем язык-detection: KB у нас русский с вкраплениями английских
 *  терминов. Один параметр проще и достаточно точен (~ ±20%, что для
 *  «≈ 3 мин» неотличимо). */
const WORDS_PER_MINUTE = 180;

/** Estimate reading time из plain-text дампа страницы.
 *  `kb_pages.plain_text` уже поддерживается миграцией 053 + обновляется
 *  в `kb_save_page` (миграция 057) на каждый save — не считаем
 *  отдельно из jsonb-блоков, это было бы CPU-впустую.
 *
 *  Возвращает целое число минут, минимум 1 (для очень коротких страниц
 *  «< 1 мин» выглядит шумно — пусть будет «≈ 1 мин»).
 *
 *  Sprint D / Phase 2 plan §2.9. */
export function estimateReadingMinutes(plainText: string | null): number {
  if (!plainText) return 1;
  const trimmed = plainText.trim();
  if (trimmed.length === 0) return 1;
  // Считаем слова через split по любому whitespace. Не считаем
  // символы — для русского/английского word-count даёт более стабильную
  // оценку (длина слов варьируется в 2-3 раза, что искажает).
  const words = trimmed.split(/\s+/).length;
  return Math.max(1, Math.round(words / WORDS_PER_MINUTE));
}

/** Format минут в человекочитаемую строку: «3 мин», «1 мин», «12 мин». */
export function formatReadingTime(minutes: number): string {
  return `${minutes} мин`;
}
