// Догрузка истории продаж для прогноза плана (KPI v2): по одному прошлому дню
// за тик, только когда очередь Quick Resto заведения пуста, — чтобы не тормозить
// загрузку сегодняшних смен. Идёт назад от первого загруженного дня до HISTORY_FROM.

export const HISTORY_FROM = "2025-01-01";
/** Столько подряд неудачных дней — Quick Resto не отдаёт историю, догрузку прекращаем. */
const STOP_AFTER_FAILED_DAYS = 5;
const FAILED_TIMES = 3;

const dayBefore = (date: string) => new Date(Date.parse(`${date}T12:00:00Z`) - 86400000).toISOString().slice(0, 10);

/** Какой день поставить в очередь следующим (или ничего). Чистая функция. */
export function historyDayToEnqueue(input: {
  existing: Set<string>;
  failedTimes: Map<string, number>;
  busy: boolean;
}): string | null {
  if (input.busy || input.existing.size === 0) return null;
  const first = [...input.existing].sort()[0];
  let failedInRow = 0;
  for (let d = dayBefore(first); d >= HISTORY_FROM; d = dayBefore(d)) {
    if (input.existing.has(d)) continue;
    if ((input.failedTimes.get(d) ?? 0) >= FAILED_TIMES) {
      if (++failedInRow >= STOP_AFTER_FAILED_DAYS) return null;
      continue;
    }
    return d;
  }
  return null;
}
