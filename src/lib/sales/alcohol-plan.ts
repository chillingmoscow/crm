// План продаж алкоголя на месяц: факт по отчёту Quick Resto и предложение
// приложения (KPI старших). Чистые функции — их гоняет node --test.

export type AlcoholReport = { month: string; revenue: number | null; through_date: string | null; state: string };
export type AlcoholSuggestion = {
  amount: number | null;
  basis: "seasonal" | "last_month" | "none";
  lastMonth: number | null;
  lastYearSame: number | null;
  lastYearPrev: number | null;
  priceIncreasePercent: number | null;
};

const shift = (month: string, by: number) => {
  const d = new Date(`${month.slice(0, 7)}-01T12:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + by);
  return d.toISOString().slice(0, 10);
};
const lastDay = (month: string) => new Date(Date.parse(`${shift(month, 1)}T00:00:00Z`) - 86400000).toISOString().slice(0, 10);
const usable = (n: number | null | undefined): n is number => typeof n === "number" && Number.isFinite(n) && n > 0;

/** Продажи алкоголя за месяц — только по готовому отчёту за полный месяц. */
export function alcoholActual(report: AlcoholReport | null, month: string): number | null {
  if (!report || report.state !== "ready" || !report.through_date) return null;
  if (report.through_date < lastDay(month)) return null;
  // Ноль за полный месяц — тоже факт: план не выполнен, а не «ждём отчёт».
  return typeof report.revenue === "number" && Number.isFinite(report.revenue) && report.revenue >= 0 ? report.revenue : null;
}

/** Продажи по месяцам: готовый полный отчёт важнее архива; ноль — нет данных. */
export function alcoholHistory(
  reports: AlcoholReport[],
  archive: { month: string; alcoholRevenue: number | null }[],
): Map<string, number> {
  const out = new Map<string, number>();
  for (const a of archive) if (usable(a.alcoholRevenue)) out.set(a.month.slice(0, 10), a.alcoholRevenue);
  for (const r of reports) {
    const month = r.month.slice(0, 10);
    const value = alcoholActual(r, month);
    if (usable(value)) out.set(month, value);
  }
  return out;
}

/**
 * Предложение плана на месяц N: последний месяц, поправленный на то, как год
 * назад продажи менялись от прошлого месяца к этому; затем повышение цен.
 * Округление вверх до 1 000 ₽.
 */
export function suggestAlcoholPlan(
  history: Map<string, number>,
  target: string,
  priceIncreasePercent: number | null,
): AlcoholSuggestion {
  const month = `${target.slice(0, 7)}-01`;
  const lastMonth = history.get(shift(month, -1)) ?? null;
  const lastYearSame = history.get(shift(month, -12)) ?? null;
  const lastYearPrev = history.get(shift(month, -13)) ?? null;
  const percent = usable(priceIncreasePercent) ? priceIncreasePercent : null;
  const base = { lastMonth, lastYearSame, lastYearPrev, priceIncreasePercent: percent };
  if (!usable(lastMonth)) return { ...base, amount: null, basis: "none" };
  const seasonal = usable(lastYearSame) && usable(lastYearPrev);
  let value = seasonal ? (lastMonth * lastYearSame) / lastYearPrev : lastMonth;
  if (percent !== null) value *= 1 + percent / 100;
  // Копеечный хвост плавающей точки не должен добавлять лишнюю тысячу.
  const amount = Math.ceil(Math.round(value * 100) / 100 / 1000) * 1000;
  return { ...base, amount, basis: seasonal ? "seasonal" : "last_month" };
}

/**
 * Факт доли алкоголя для KPI: только за закончившийся месяц и только по
 * полному готовому отчёту. Саму долю считает `statisticsRevenueShare` на
 * сервере (сверка рабочих периодов отчёта и смен) и передаёт её в `share`.
 */
export function alcoholShareStatus(input: {
  month: string;
  today: string;
  report: { state: string; through_date: string | null; revenue: number | null } | null;
  share: number | null;
}): { actual: number | null; pending: "month" | "report" | null } {
  const next = new Date(Date.parse(`${input.month.slice(0, 7)}-01T12:00:00Z`));
  next.setUTCMonth(next.getUTCMonth() + 1);
  if (input.today < next.toISOString().slice(0, 10)) return { actual: null, pending: "month" };
  const full = input.report ? alcoholActual({ month: input.month, ...input.report }, input.month) : null;
  if (full === null || input.share === null || !Number.isFinite(input.share)) return { actual: null, pending: "report" };
  return { actual: input.share, pending: null };
}
