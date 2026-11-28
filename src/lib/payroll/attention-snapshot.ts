// Уведомление «ждут проверки» (`AttendanceAttentionNotice`): счётчики за
// набор месяцев. Сервер считает их при отрисовке страницы, браузер — потом по
// таймеру; ключ у обоих один, чтобы браузер узнал серверные счётчики.

/**
 * Счётчики «ждут проверки» за набор месяцев; `key` — месяцы через запятую,
 * `at` — когда сервер их посчитал (мс).
 */
export type AttentionSnapshot = { key: string; items: { month: string; count: number }[]; at: number };

/**
 * Серверные данные страницы ещё свежие — первое чтение в браузере можно
 * пропустить. Старые приходят при возврате «Назад» (Next берёт ответ из
 * кэша роутера) или при повторном монтировании блока — их перечитываем.
 */
export function serverDataFresh(at: number | undefined, now = Date.now()) {
  return at !== undefined && now - at >= 0 && now - at < 30_000;
}

/** Ключ набора месяцев `YYYY-MM`: без повторов, по порядку. */
export function attentionKey(months: string[]) {
  return [...new Set(months)].sort().join(",");
}
