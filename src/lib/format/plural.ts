/**
 * Русская плюрализация по числу: one / few / many.
 *   pluralRu(1, "строка", "строки", "строк")  → "строка"
 *   pluralRu(3, …)                            → "строки"
 *   pluralRu(5, …)                            → "строк"
 *   pluralRu(11, …)                           → "строк" (особый случай 11–14)
 */
export function pluralRu(n: number, one: string, few: string, many: string): string {
  const mod10 = Math.abs(n) % 10;
  const mod100 = Math.abs(n) % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return few;
  return many;
}

/**
 * Число со словом в нужной форме: «1 операция», «2 смены», «5 записей».
 * Число через неразрывный пробел, чтобы «5» не отрывалось от слова.
 */
export function countRu(n: number, one: string, few: string, many: string): string {
  return `${n.toLocaleString("ru-RU")} ${pluralRu(n, one, few, many)}`;
}
