/**
 * Резкое отклонение месячной недостачи от обычной.
 *
 * Между ошибочным актом и ведомостью больше нет человека (удержание ставится
 * автоматически), поэтому месяц, сильно выбивающийся из обычного, даёт
 * уведомление. Уведомление ТОЛЬКО предупреждает: оно никогда не решает,
 * ставить строку или нет. Иначе предупреждение стало бы скрытым утверждением.
 *
 * Сравнивается недостача заведения до лимита (`total` расчёта), а не сумма на
 * сотрудников: лимит заведения скрывает рост, пока не исчерпан.
 *
 * Без импортов из `@/...`: тест-раннер не резолвит alias из tsconfig.
 */

/** Сколько прошлых посчитанных месяцев образуют «обычное». */
export const ANOMALY_HISTORY_MONTHS = 3;
/** Месяц тревожен, если больше медианы в столько раз... */
export const ANOMALY_RATIO = 2;
/** ...и при этом выше медианы не меньше чем на столько рублей (иначе шум на малых суммах). */
export const ANOMALY_MIN_EXCESS = 1000;

/** Посчитанный месяц: первое число месяца (`YYYY-MM-01`) и недостача заведения за него. */
export type HistoryMonth = { month: string; total: number };

export type AnomalyVerdict =
  | { kind: "not_enough_history"; months: number }
  | { kind: "normal"; median: number }
  | { kind: "anomaly"; median: number; current: number; ratio: number | null };

export function medianOf(values: number[]): number {
  if (values.length === 0) throw new Error("Медиана пустого набора не определена");
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : Math.round(((s[mid - 1] + s[mid]) / 2) * 100) / 100;
}

/**
 * `history` - все известные посчитанные месяцы заведения в любом порядке. Берутся
 * три самых свежих ДО текущего (текущий и более поздние не считаются «историей»).
 * Если их меньше трёх, вердикт «мало истории»: сравнивать с одним-двумя месяцами
 * значит выдавать случайность за норму.
 */
export function detectDeductionAnomaly(input: {
  month: string;
  current: number;
  history: HistoryMonth[];
}): AnomalyVerdict {
  const byMonth = new Map<string, number>();
  for (const h of input.history) {
    if (h.month >= input.month) continue;
    byMonth.set(h.month, h.total);
  }
  const recent = [...byMonth.entries()]
    .sort((a, b) => (a[0] < b[0] ? 1 : -1))
    .slice(0, ANOMALY_HISTORY_MONTHS)
    .map(([, total]) => total);
  if (recent.length < ANOMALY_HISTORY_MONTHS)
    return { kind: "not_enough_history", months: recent.length };

  const median = medianOf(recent);
  const exceeds =
    input.current > median * ANOMALY_RATIO &&
    input.current - median >= ANOMALY_MIN_EXCESS;
  if (!exceeds) return { kind: "normal", median };
  return {
    kind: "anomaly",
    median,
    current: input.current,
    ratio: median > 0 ? Math.round((input.current / median) * 100) / 100 : null,
  };
}
