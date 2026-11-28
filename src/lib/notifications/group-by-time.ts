/**
 * Time-grouping для notifications-bell (Notion-style).
 *
 * Buckets:
 *   • Today — created_at >= startOfToday(now).
 *   • This week — created_at >= startOfThisWeek (Mon).
 *   • Last week — previous week.
 *   • Older — всё остальное.
 *
 * Внутри каждой группы сохраняется исходный порядок (DESC по
 *  created_at — caller обычно сортирует так).
 */

export type TimeBucket = "today" | "this_week" | "last_week" | "older";

export const TIME_BUCKET_LABELS: Record<TimeBucket, string> = {
  today: "Сегодня",
  this_week: "На этой неделе",
  last_week: "На прошлой неделе",
  older: "Раньше",
};

export const TIME_BUCKET_ORDER: TimeBucket[] = [
  "today",
  "this_week",
  "last_week",
  "older",
];

interface HasCreatedAt {
  created_at: string;
}

/** «2026-11-27» — календарный день момента в поясе `timeZone`. */
function dayInZone(value: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(value);
  const part = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

/** День `iso` («2026-11-27») со сдвигом на `days` дней. */
function shiftDay(iso: string, days: number): string {
  const date = new Date(`${iso}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/**
 * Возвращает Map от bucket'а к массиву items. Buckets без rows
 * отсутствуют в Map (caller должен проверять `.has(bucket)`).
 *
 * Границы дней — в поясе `timeZone` (по умолчанию — пояс устройства). Список
 * рисует и сервер (страница «Уведомления»), а он живёт в UTC: с явным поясом
 * и тем же `now` группы в разметке и в браузере совпадают.
 */
export function groupByTimeBucket<T extends HasCreatedAt>(
  items: T[],
  now: Date = new Date(),
  timeZone: string = Intl.DateTimeFormat().resolvedOptions().timeZone,
): Map<TimeBucket, T[]> {
  const today = dayInZone(now, timeZone);
  // Неделя с понедельника: getUTCDay у полуночи UTC этого дня — его день недели.
  const dayOffset = (new Date(`${today}T00:00:00Z`).getUTCDay() + 6) % 7;
  const startOfThisWeek = shiftDay(today, -dayOffset);
  const startOfLastWeek = shiftDay(startOfThisWeek, -7);

  const result = new Map<TimeBucket, T[]>();
  for (const item of items) {
    const created = dayInZone(new Date(item.created_at), timeZone);
    let bucket: TimeBucket;
    if (created >= today) {
      bucket = "today";
    } else if (created >= startOfThisWeek) {
      bucket = "this_week";
    } else if (created >= startOfLastWeek) {
      bucket = "last_week";
    } else {
      bucket = "older";
    }
    const arr = result.get(bucket) ?? [];
    arr.push(item);
    result.set(bucket, arr);
  }
  return result;
}
