/**
 * Чистые расчёты главной страницы «Сегодня»: приветствие по времени суток,
 * текущая неделя, дни рождения и годовщины работы. Без React и Supabase —
 * их гоняет `node --test`, а страница и серверные хелперы делят одну логику.
 *
 * Все дни — календарные `YYYY-MM-DD` в поясе заведения: вызывающий сам
 * переводит «сейчас» в этот пояс.
 */

/** «Доброе утро» / «Добрый день» / «Добрый вечер» / «Доброй ночи» по часу 0–23. */
export function greetingFor(hour: number): string {
  if (hour >= 5 && hour < 12) return "Доброе утро";
  if (hour >= 12 && hour < 18) return "Добрый день";
  if (hour >= 18 && hour < 23) return "Добрый вечер";
  return "Доброй ночи";
}

function utcDay(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

function iso(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function addDaysIso(day: string, n: number): string {
  const date = utcDay(day);
  date.setUTCDate(date.getUTCDate() + n);
  return iso(date);
}

/** Неделя с понедельника по воскресенье, в которую попадает `today`. */
export function weekOf(today: string): { from: string; to: string } {
  const weekday = utcDay(today).getUTCDay(); // 0 — воскресенье
  const from = addDaysIso(today, weekday === 0 ? -6 : 1 - weekday);
  return { from, to: addDaysIso(from, 6) };
}

export type CelebrationPerson = {
  userId: string;
  name: string;
  avatarUrl: string | null;
  role: string | null;
  /** `YYYY-MM-DD` или `null`, если дату не заполнили (или её не видно по правам). */
  birthDate: string | null;
  /** Дата трудоустройства `YYYY-MM-DD`. */
  employmentDate: string | null;
};

export type Celebration = {
  kind: "birthday" | "anniversary";
  userId: string;
  name: string;
  avatarUrl: string | null;
  role: string | null;
  /** День праздника на этой неделе. */
  date: string;
  /** Исполняется лет (день рождения) или лет в команде (годовщина); `null` — год рождения неизвестен. */
  years: number | null;
};

/** Тот же день-месяц в году `year`; 29 февраля в невисокосный год — 28-е. */
function sameDayIn(date: string, year: number): string {
  const [, m, d] = date.split("-").map(Number);
  const last = new Date(Date.UTC(year, m, 0)).getUTCDate();
  return iso(new Date(Date.UTC(year, m - 1, Math.min(d, last))));
}

/** Праздник даты `date` внутри недели `week`, если он на неё выпадает. */
function occurrence(date: string, week: { from: string; to: string }): string | null {
  const years = new Set([Number(week.from.slice(0, 4)), Number(week.to.slice(0, 4))]);
  for (const year of years) {
    const day = sameDayIn(date, year);
    if (day >= week.from && day <= week.to) return day;
  }
  return null;
}

/**
 * Дни рождения и годовщины работы (от года в команде) на неделе `week`, по
 * порядку дней. Годовщина в первый же год (день трудоустройства) не считается:
 * это не праздник, а первый день. Год рождения 1900 и раньше — служебная
 * заглушка «год неизвестен»: возраст не пишем.
 */
/**
 * Дата трудоустройства, если её правда указали. `get_venue_staff` без неё
 * подставляет день, когда человека добавили в заведение (`joined_at`, дата в
 * UTC), — у штата, заведённого за одну неделю, через год у всех была бы
 * «годовщина». Совпадает с днём добавления — считаем, что даты нет.
 */
export function knownEmploymentDate(employment: string | null, joinedAt: string | null): string | null {
  if (!employment) return null;
  const joined = joinedAt ? new Date(joinedAt) : null;
  if (joined && !Number.isNaN(joined.getTime()) && joined.toISOString().slice(0, 10) === employment) return null;
  return employment;
}

export function weekCelebrations(
  people: CelebrationPerson[],
  week: { from: string; to: string },
): Celebration[] {
  const out: Celebration[] = [];
  for (const p of people) {
    const base = { userId: p.userId, name: p.name, avatarUrl: p.avatarUrl, role: p.role };
    if (p.birthDate) {
      const day = occurrence(p.birthDate, week);
      if (day) {
        const born = Number(p.birthDate.slice(0, 4));
        out.push({ ...base, kind: "birthday", date: day, years: born > 1900 ? Number(day.slice(0, 4)) - born : null });
      }
    }
    if (p.employmentDate) {
      const day = occurrence(p.employmentDate, week);
      const years = day ? Number(day.slice(0, 4)) - Number(p.employmentDate.slice(0, 4)) : 0;
      if (day && years >= 1) out.push({ ...base, kind: "anniversary", date: day, years });
    }
  }
  return out.sort(
    (a, b) =>
      a.date.localeCompare(b.date) ||
      (a.kind === b.kind ? 0 : a.kind === "birthday" ? -1 : 1) ||
      a.name.localeCompare(b.name, "ru"),
  );
}

/** «Сегодня», «Завтра», «Вчера» или `null` — тогда вызывающий пишет дату. */
export function relativeDayLabel(day: string, today: string): string | null {
  if (day === today) return "Сегодня";
  if (day === addDaysIso(today, 1)) return "Завтра";
  if (day === addDaysIso(today, -1)) return "Вчера";
  return null;
}
