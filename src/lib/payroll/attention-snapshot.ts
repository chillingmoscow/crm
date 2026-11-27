// Уведомление «ждут проверки» (`AttendanceAttentionNotice`): счётчики за
// набор месяцев. Сервер считает их при отрисовке страницы, браузер — потом по
// таймеру; ключ у обоих один, чтобы браузер узнал серверные счётчики.

/** Счётчики «ждут проверки» за набор месяцев; `key` — месяцы через запятую. */
export type AttentionSnapshot = { key: string; items: { month: string; count: number }[] };

/** Ключ набора месяцев `YYYY-MM`: без повторов, по порядку. */
export function attentionKey(months: string[]) {
  return [...new Set(months)].sort().join(",");
}
