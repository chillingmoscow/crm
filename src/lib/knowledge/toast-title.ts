/** Название страницы для уведомления: до 28 знаков, дальше «…» — чтобы
 *  уведомление с кнопкой «Отменить» помещалось в одну строку. */
export function kbToastTitle(title: string): string {
  const t = title.trim();
  return t.length > 28 ? `${t.slice(0, 27).trimEnd()}…` : t;
}
