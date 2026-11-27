/** Границы месяца «YYYY-MM» для фильтра по business_date: [from, until). */
export function payrollMonthRange(month: string): { from: string; until: string } {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new Error("Некорректный месяц");
  const [year, m] = month.split("-").map(Number);
  const next = m === 12 ? `${year + 1}-01` : `${year}-${String(m + 1).padStart(2, "0")}`;
  return { from: `${month}-01`, until: `${next}-01` };
}
