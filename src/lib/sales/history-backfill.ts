// Догрузка истории продаж для прогноза плана (KPI v2): по одному прошлому дню
// за тик, только когда очередь Quick Resto заведения пуста, — чтобы не тормозить
// загрузку сегодняшних смен. Идёт назад от самого раннего загруженного дня до
// HISTORY_FROM и останавливается, если Quick Resto историю не отдаёт.

export const HISTORY_FROM = "2025-01-01";
/** Столько подряд неудачных или пустых дней — Quick Resto не отдаёт историю, стоп. */
const STOP_AFTER_DAYS = 5;
const FAILED_TIMES = 3;

/** Состояние дня в sales_days: загружен, загружен пустым (нулевой оборот), строка ошибки загрузки. */
export type HistoryDay = "ok" | "empty" | "error";

const dayBefore = (date: string) => new Date(Date.parse(`${date}T12:00:00Z`) - 86400000).toISOString().slice(0, 10);

/** Какой день поставить в очередь следующим (или ничего). Чистая функция. */
export function historyDayToEnqueue(input: {
  days: Map<string, HistoryDay>;
  failedTimes: Map<string, number>;
  busy: boolean;
}): string | null {
  if (input.busy) return null;
  // Строка с ошибкой загрузки — не загруженный день: её оставляет неудачный срез.
  const loaded = [...input.days].filter(([, state]) => state !== "error").map(([d]) => d).sort();
  if (!loaded.length) return null;
  // Самые ранние загруженные дни — последние догруженные: все пустые — история нулевая.
  const oldest = loaded.slice(0, STOP_AFTER_DAYS);
  if (oldest.length === STOP_AFTER_DAYS && oldest.every((d) => input.days.get(d) === "empty")) return null;
  let failedInRow = 0;
  for (let d = dayBefore(loaded[0]); d >= HISTORY_FROM; d = dayBefore(d)) {
    if ((input.failedTimes.get(d) ?? 0) >= FAILED_TIMES) {
      if (++failedInRow >= STOP_AFTER_DAYS) return null;
      continue;
    }
    return d;
  }
  return null;
}
