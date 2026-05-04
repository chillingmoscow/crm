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

/** Возвращает Map от bucket'а к массиву items. Buckets без rows
 *  отсутствуют в Map (caller должен проверять `.has(bucket)`). */
export function groupByTimeBucket<T extends HasCreatedAt>(
  items: T[],
  now: Date = new Date(),
): Map<TimeBucket, T[]> {
  const startOfToday = new Date(now);
  startOfToday.setHours(0, 0, 0, 0);

  const startOfThisWeek = new Date(startOfToday);
  // Monday-based week. JS: getDay() returns 0=Sun, 1=Mon, ...; offset
  // от понедельника = (day + 6) % 7.
  const dayOffset = (startOfToday.getDay() + 6) % 7;
  startOfThisWeek.setDate(startOfThisWeek.getDate() - dayOffset);

  const startOfLastWeek = new Date(startOfThisWeek);
  startOfLastWeek.setDate(startOfLastWeek.getDate() - 7);

  const result = new Map<TimeBucket, T[]>();
  for (const item of items) {
    const created = new Date(item.created_at);
    let bucket: TimeBucket;
    if (created >= startOfToday) {
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
