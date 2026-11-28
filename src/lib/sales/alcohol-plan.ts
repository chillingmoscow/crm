// Продажи алкоголя за месяц для KPI старших: факт только по полному отчёту
// Quick Resto и только за закончившийся месяц. Чистые функции — их гоняет node --test.

export type AlcoholReport = { month: string; revenue: number | null; through_date: string | null; state: string };

const shift = (month: string, by: number) => {
  const d = new Date(`${month.slice(0, 7)}-01T12:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + by);
  return d.toISOString().slice(0, 10);
};
const lastDay = (month: string) => new Date(Date.parse(`${shift(month, 1)}T00:00:00Z`) - 86400000).toISOString().slice(0, 10);

/** Продажи алкоголя за месяц — только по готовому отчёту за полный месяц. */
export function alcoholActual(report: AlcoholReport | null, month: string): number | null {
  if (!report || report.state !== "ready" || !report.through_date) return null;
  if (report.through_date < lastDay(month)) return null;
  // Ноль за полный месяц — тоже факт: план не выполнен, а не «ждём отчёт».
  return typeof report.revenue === "number" && Number.isFinite(report.revenue) && report.revenue >= 0 ? report.revenue : null;
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
