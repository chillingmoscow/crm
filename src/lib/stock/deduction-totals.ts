/**
 * Итоги сличения: арифметика, на которой страница показывает деньги.
 *
 * Неизвестное не превращается в ноль: пустая вставка или хоть одна неизвестная сумма дают
 * `null`, а не 0, и разница с неизвестным тоже `null` (иначе страница уверенно показала бы
 * «полное расхождение» против пустоты). Считается в копейках.
 *
 * Без импортов из `@/...`: тест-раннер не резолвит alias из tsconfig.
 */

const toCents = (n: number) => Math.round(n * 100);

/**
 * Итог таблицы по прочитанным строкам.
 * - ничего не прочитано -> `total: null` (одна строка заголовка не равна «таблица на ноль рублей»);
 * - есть неизвестная сумма -> `total: null`, `incomplete`;
 * - есть нечитаемые строки -> итог известных строк остаётся, но `incomplete`: он занижен.
 */
export function sheetTotal(
  entries: Array<{ amount: number | null }>,
  unreadableLines: number,
): { total: number | null; incomplete: boolean } {
  if (entries.some((e) => e.amount === null)) return { total: null, incomplete: true };
  if (entries.length === 0) return { total: null, incomplete: unreadableLines > 0 };
  const total = entries.reduce((sum, e) => sum + toCents(e.amount!), 0) / 100;
  return { total, incomplete: unreadableLines > 0 };
}

/** Основание минус таблица; неизвестная сторона даёт `null`. */
export function totalDelta(basis: number | null, sheet: number | null): number | null {
  if (basis === null || sheet === null) return null;
  return (toCents(basis) - toCents(sheet)) / 100;
}
