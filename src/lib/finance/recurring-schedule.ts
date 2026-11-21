/**
 * Расписание повторяющегося платежа словами и мелкие помощники над датами.
 * Модуль чистый: даты — строки `YYYY-MM-DD`, без часовых поясов.
 */
import type { RecurringSchedule } from "../../types/finance.ts";

/** Число месяца 31 в шаблоне — «последний день» (в коротких месяцах прижимается). */
export const LAST_DAY_OF_MONTH = 31;

const WEEKDAYS_DATIVE = [
  "понедельникам",
  "вторникам",
  "средам",
  "четвергам",
  "пятницам",
  "субботам",
  "воскресеньям",
];

export const WEEKDAY_LABELS = [
  "Понедельник",
  "Вторник",
  "Среда",
  "Четверг",
  "Пятница",
  "Суббота",
  "Воскресенье",
];

const QUARTER_MONTH_PREPOSITIONAL = ["в первом месяце", "во втором месяце", "в третьем месяце"];

export function describeSchedule(s: RecurringSchedule): string {
  if (s.frequency === "weekly") {
    return `каждую неделю по ${WEEKDAYS_DATIVE[s.weekday - 1] ?? "дням"}`;
  }
  const day = s.dayOfMonth >= LAST_DAY_OF_MONTH ? "в последний день" : `${s.dayOfMonth}-го`;
  if (s.frequency === "monthly") return `каждый месяц ${day}`;
  return `каждый квартал ${day} ${QUARTER_MONTH_PREPOSITIONAL[s.quarterMonth - 1]}`;
}

function utcDay(iso: string): number {
  const [y, m, d] = iso.split("-").map(Number);
  return Date.UTC(y, m - 1, d) / 86_400_000;
}

/** Сколько полных дней прошло с срока `dueDate` до `today`; 0, если не просрочен. */
export function overdueDays(dueDate: string, today: string): number {
  return Math.max(0, Math.round(utcDay(today) - utcDay(dueDate)));
}

export function scheduleFromTemplate(t: {
  frequency: string;
  day_of_month: number | null;
  weekday: number | null;
  quarter_month: number | null;
}): RecurringSchedule {
  if (t.frequency === "weekly") return { frequency: "weekly", weekday: t.weekday ?? 1 };
  const dayOfMonth = t.day_of_month ?? 1;
  if (t.frequency === "quarterly") {
    const q = t.quarter_month;
    return {
      frequency: "quarterly",
      dayOfMonth,
      quarterMonth: q === 2 || q === 3 ? q : 1,
    };
  }
  return { frequency: "monthly", dayOfMonth };
}

export function defaultScheduleFromDate(date: string): RecurringSchedule {
  return { frequency: "monthly", dayOfMonth: Number(date.slice(8, 10)) || 1 };
}
