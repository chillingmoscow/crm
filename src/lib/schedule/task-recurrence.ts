import { pluralRu } from "../format/plural.ts";

/**
 * Подпись повтора задачи с днём, как его понимает сервер
 * (private.schedule_task_due): отсчёт от даты-якоря; для недель — тот же
 * день недели, для месяцев — то же число.
 *   «Каждый вторник», «Раз в 2 недели · по вторникам»,
 *   «Каждый месяц · 15-го», «Раз в 3 месяца · 15-го».
 */
export type TaskRecurrence = { unit: "week" | "month"; interval: number; anchor: string };

const WEEKDAY = [
  { every: "Каждый понедельник", plural: "понедельникам" },
  { every: "Каждый вторник", plural: "вторникам" },
  { every: "Каждую среду", plural: "средам" },
  { every: "Каждый четверг", plural: "четвергам" },
  { every: "Каждую пятницу", plural: "пятницам" },
  { every: "Каждую субботу", plural: "субботам" },
  { every: "Каждое воскресенье", plural: "воскресеньям" },
];

export function taskRecurrenceLabel(r: TaskRecurrence | null | undefined): string | null {
  if (!r || !r.anchor || !(r.interval >= 1)) return null;
  const anchor = new Date(`${r.anchor}T12:00:00Z`);
  if (Number.isNaN(anchor.getTime())) return null;
  if (r.unit === "week") {
    const day = WEEKDAY[(anchor.getUTCDay() + 6) % 7];
    if (r.interval === 1) return day.every;
    return `Раз в ${r.interval} ${pluralRu(r.interval, "неделю", "недели", "недель")} · по ${day.plural}`;
  }
  const date = `${anchor.getUTCDate()}-го`;
  if (r.interval === 1) return `Каждый месяц · ${date}`;
  return `Раз в ${r.interval} ${pluralRu(r.interval, "месяц", "месяца", "месяцев")} · ${date}`;
}
