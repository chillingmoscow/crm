// Чистые расчёты для раздела «Люди»: кто сейчас на смене, стаж, тепловая
// карта смен. Без импортов приложения — проверяются `node --test`.
import { countRu } from "../format/plural.ts";

// ── Кто сейчас на смене ─────────────────────────────────────

/** Опубликованная смена графика. */
export type PresenceShift = {
  user_id: string | null;
  payroll_employee_id: string | null;
  starts_at: string;
  ends_at: string;
};

/** Отметка прихода из кассы; `user_id` — сотрудник Sheerly зарплатной карточки. */
export type PresenceClock = {
  employee_id: string | null;
  user_id: string | null;
  starts_at: string;
  ends_at: string | null;
};

/** Открытая отметка старше этого не считается сменой: забыли закрыть. */
export const OPEN_CLOCK_MAX_HOURS = 16;

const HOUR = 3_600_000;

/**
 * Кто на смене в момент `now`. Отметка — факт: открытая отметка прихода
 * (не старше `OPEN_CLOCK_MAX_HOURS`) значит «на смене». Опубликованная смена,
 * которая идёт сейчас, — тоже, если человек с неё уже не ушёл (закрытая
 * отметка после начала смены).
 */
export function onShiftNow(
  now: number,
  shifts: PresenceShift[],
  clocks: PresenceClock[],
): { userIds: string[]; employeeIds: string[] } {
  const users = new Set<string>();
  const employees = new Set<string>();
  const mark = (userId: string | null, employeeId: string | null) => {
    if (userId) users.add(userId);
    if (employeeId) employees.add(employeeId);
  };
  const samePerson = (
    clock: PresenceClock,
    userId: string | null,
    employeeId: string | null,
  ) =>
    (!!userId && clock.user_id === userId) ||
    (!!employeeId && clock.employee_id === employeeId);

  for (const clock of clocks) {
    const start = Date.parse(clock.starts_at);
    if (clock.ends_at !== null || start > now) continue;
    if (now - start > OPEN_CLOCK_MAX_HOURS * HOUR) continue;
    mark(clock.user_id, clock.employee_id);
  }
  for (const shift of shifts) {
    const start = Date.parse(shift.starts_at);
    const end = Date.parse(shift.ends_at);
    if (start > now || end <= now) continue;
    const left = clocks.some(
      (clock) =>
        clock.ends_at !== null &&
        samePerson(clock, shift.user_id, shift.payroll_employee_id) &&
        Date.parse(clock.ends_at) > start &&
        Date.parse(clock.ends_at) <= now &&
        // Ушёл и вернулся — открытая отметка уже отметила его выше.
        !clocks.some(
          (open) =>
            open.ends_at === null &&
            samePerson(open, shift.user_id, shift.payroll_employee_id) &&
            Date.parse(open.starts_at) >= Date.parse(clock.ends_at!),
        ),
    );
    if (!left) mark(shift.user_id, shift.payroll_employee_id);
  }
  return { userIds: [...users], employeeIds: [...employees] };
}

// ── Стаж ────────────────────────────────────────────────────

/** Полных месяцев между датами `YYYY-MM-DD` (не меньше нуля). */
export function fullMonthsBetween(from: string, to: string): number {
  const [fy, fm, fd] = from.slice(0, 10).split("-").map(Number);
  const [ty, tm, td] = to.slice(0, 10).split("-").map(Number);
  if (!fy || !ty) return 0;
  const months = (ty - fy) * 12 + (tm - fm) - (td < fd ? 1 : 0);
  return Math.max(0, months);
}

/**
 * Стаж для шапки карточки: «работает 1 год 6 мес», «работает 3 мес»,
 * «работает меньше месяца». null — дата начала в будущем или не задана.
 */
export function tenureLabel(from: string | null | undefined, today: string): string | null {
  if (!from) return null;
  if (from.slice(0, 10) > today) return null;
  const months = fullMonthsBetween(from, today);
  if (months === 0) return "работает меньше месяца";
  const years = Math.floor(months / 12);
  const rest = months % 12;
  const parts = [
    years > 0 ? countRu(years, "год", "года", "лет") : null,
    rest > 0 ? `${rest}\u00a0мес` : null,
  ].filter(Boolean);
  return `работает ${parts.join(" ")}`;
}

// ── Тепловая карта смен ─────────────────────────────────────

export type HeatmapDay = { date: string; hours: number; level: 0 | 1 | 2 | 3 | 4; future: boolean };

/** Насыщенность клетки по часам за день: 0 — смен нет. */
export function heatLevel(hours: number): HeatmapDay["level"] {
  if (hours <= 0) return 0;
  if (hours < 4) return 1;
  if (hours < 8) return 2;
  if (hours < 11) return 3;
  return 4;
}

const addDay = (date: string, count: number) => {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + count);
  return d.toISOString().slice(0, 10);
};

/** День недели с понедельника: 0 — пн, 6 — вс. */
const weekday = (date: string) => (new Date(`${date}T12:00:00Z`).getUTCDay() + 6) % 7;

/**
 * Год смен столбцами-неделями, как вклады на GitHub: столбец — неделя с
 * понедельника, последний столбец — текущая неделя. Дни после `today` —
 * пустые клетки (`future`), чтобы сетка оставалась прямоугольной.
 */
export function heatmapWeeks(
  hoursByDate: Record<string, number>,
  today: string,
  weeks = 53,
): HeatmapDay[][] {
  const lastMonday = addDay(today, -weekday(today));
  const first = addDay(lastMonday, -(weeks - 1) * 7);
  const columns: HeatmapDay[][] = [];
  for (let w = 0; w < weeks; w++) {
    const column: HeatmapDay[] = [];
    for (let d = 0; d < 7; d++) {
      const date = addDay(first, w * 7 + d);
      const future = date > today;
      const hours = future ? 0 : Math.round((hoursByDate[date] ?? 0) * 10) / 10;
      column.push({ date, hours, level: future ? 0 : heatLevel(hours), future });
    }
    columns.push(column);
  }
  return columns;
}

/** Первый день окна тепловой карты — для запроса данных. */
export function heatmapStart(today: string, weeks = 53): string {
  return addDay(addDay(today, -weekday(today)), -(weeks - 1) * 7);
}

/**
 * Часы по рабочим дням: отметки — факт и заменяют график за свой день;
 * без отметок за день считаются опубликованные смены. Смены и отметки уже
 * разложены по рабочим дням заведения (`date`).
 *
 * `verified` — дни, которые зарплатный учёт уже сверил с кассой: в отметки
 * за них попали и смены, засчитанные по графику, а невыход не попал. За
 * такой день график не подставляем — нет отметки, значит не работал.
 * Смены, которые управляющий не засчитал («не пришёл»), вызывающий убирает
 * из `planned` сам.
 */
export function hoursByDay(
  planned: { date: string; hours: number }[],
  marked: { date: string; hours: number }[],
  verified: ReadonlySet<string> = new Set(),
): Record<string, number> {
  const fact: Record<string, number> = {};
  for (const m of marked) fact[m.date] = (fact[m.date] ?? 0) + Math.max(0, m.hours);
  const result: Record<string, number> = { ...fact };
  for (const p of planned)
    if (!(p.date in fact) && !verified.has(p.date))
      result[p.date] = (result[p.date] ?? 0) + Math.max(0, p.hours);
  return result;
}
