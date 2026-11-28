/** Название страницы для уведомления: до 20 знаков, дальше «…» — чтобы
 *  «„…“ в корзине» с кнопкой «Отменить» помещалось в одну строку тоста
 *  (356px: на текст остаётся ≈ 235px при 13px / 500). Считаем по символам
 *  (Array.from), а не по UTF-16: эмодзи на границе не разрезается. */
export const KB_TOAST_TITLE_MAX = 20;

export function kbToastTitle(title: string): string {
  const chars = Array.from(title.trim());
  if (chars.length <= KB_TOAST_TITLE_MAX) return chars.join("");
  return `${chars.slice(0, KB_TOAST_TITLE_MAX - 1).join("").trimEnd()}…`;
}
