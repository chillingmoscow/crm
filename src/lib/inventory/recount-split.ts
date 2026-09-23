// Развилка «пересчёт сегодня / пересчёт другим днём».
//
// Расчётный остаток в Quick Resto привязан к дате акта, поэтому пересчёт,
// сделанный другим днём, нельзя сравнивать с остатком на дату акта: поставка
// между датами станет излишком, продажи — недостачей. Такие позиции выносятся
// в отдельный акт с датой пересчёта.

export type RecountMode = "inplace" | "split";

/** Дата в формате YYYY-MM-DD из ISO-строки (или null). */
export function isoDay(value: string | null | undefined): string | null {
  if (!value) return null;
  const day = value.slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(day) ? day : null;
}

/**
 * Режим по умолчанию: акт сегодняшний — считаем в нём же, иначе предлагаем
 * отдельный акт. Если дата акта неизвестна, безопаснее предложить отдельный:
 * он корректен в любом случае, тогда как пересчёт «в акте» верен только в день
 * подсчёта.
 */
export function defaultRecountMode(actInvoiceDate: string | null | undefined, today: string): RecountMode {
  const actDay = isoDay(actInvoiceDate);
  if (!actDay) return "split";
  return actDay === today ? "inplace" : "split";
}

/** Насколько дата пересчёта отстоит от даты акта (в сутках). */
export function recountGapDays(actInvoiceDate: string | null | undefined, recountDate: string): number | null {
  const actDay = isoDay(actInvoiceDate);
  const target = isoDay(recountDate);
  if (!actDay || !target) return null;
  const diff = Date.parse(`${target}T00:00:00.000Z`) - Date.parse(`${actDay}T00:00:00.000Z`);
  return Math.round(diff / 86_400_000);
}
