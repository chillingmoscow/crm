/**
 * Разовые сотрудники в выборе исполнителя смены.
 *
 * Разовый сотрудник остаётся в общем списке, пока у него есть смены в
 * последние CASUAL_RECENT_DAYS дней или впереди. Остальные считаются
 * «бывшими»: они скрыты и находятся поиском или кнопкой «Показать бывших».
 */
export const CASUAL_RECENT_DAYS = 30;

function shiftDate(date: string, days: number) {
  const d = new Date(date + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function splitCasualEmployees<T extends { id: string }>({
  employees,
  shiftDates,
  today,
  keep = [],
}: {
  employees: T[];
  /** Даты смен (YYYY-MM-DD в часовом поясе заведения) по id разового сотрудника. */
  shiftDates: { employeeId: string; date: string }[];
  today: string;
  /** id, которые всегда считаются актуальными (например, выбранный сейчас). */
  keep?: string[];
}): { recent: T[]; former: T[] } {
  const since = shiftDate(today, -CASUAL_RECENT_DAYS);
  const active = new Set(keep);
  for (const s of shiftDates) if (s.date >= since) active.add(s.employeeId);
  const recent: T[] = [];
  const former: T[] = [];
  for (const e of employees) (active.has(e.id) ? recent : former).push(e);
  return { recent, former };
}
