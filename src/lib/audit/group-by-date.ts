import type { AuditEvent } from "@/lib/audit/list";

export interface AuditGroup {
  /** Ключ дня — `YYYY-MM-DD` в выбранной таймзоне. Стабилен для key prop. */
  dayKey: string;
  /** Заголовок секции: «Сегодня» / «Вчера» / «5 мая» / «5 мая 2025». */
  title: string;
  events: AuditEvent[];
}

/** Группирует события по дню в порядке убывания даты. Не сортирует
 *  события внутри группы — вход уже отсортирован по `created_at DESC`.
 *
 *  `timeZone` — часовой пояс, в котором считаются сутки (у карточек —
 *  часовой пояс заведения, как у времени в строке). Без него — пояс
 *  браузера. */
export function groupEventsByDate(
  events: AuditEvent[],
  timeZone?: string,
  now: Date = new Date(),
): AuditGroup[] {
  if (events.length === 0) return [];

  const dayKeyOf = dayKeyFormatter(timeZone);
  const todayKey = dayKeyOf(now);
  const yesterdayKey = shiftDayKey(todayKey, -1);

  const groups: AuditGroup[] = [];
  let current: AuditGroup | null = null;

  for (const event of events) {
    const dayKey = dayKeyOf(new Date(event.created_at));
    if (!current || current.dayKey !== dayKey) {
      current = {
        dayKey,
        title: titleForDay(dayKey, todayKey, yesterdayKey),
        events: [],
      };
      groups.push(current);
    }
    current.events.push(event);
  }

  return groups;
}

function dayKeyFormatter(timeZone?: string): (d: Date) => string {
  // en-CA даёт ГГГГ-ММ-ДД; собираем из частей, чтобы не зависеть от
  // разделителей конкретной версии ICU.
  const format = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return (d) => {
    const parts = format.formatToParts(d);
    const part = (type: string) =>
      parts.find((p) => p.type === type)?.value ?? "";
    return `${part("year")}-${part("month")}-${part("day")}`;
  };
}

function keyToUtcNoon(dayKey: string): Date {
  return new Date(`${dayKey}T12:00:00Z`);
}

function shiftDayKey(dayKey: string, days: number): string {
  const d = keyToUtcNoon(dayKey);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function titleForDay(
  dayKey: string,
  todayKey: string,
  yesterdayKey: string,
): string {
  if (dayKey === todayKey) return "Сегодня";
  if (dayKey === yesterdayKey) return "Вчера";
  // Текущий год — без года в заголовке (короче). Другой год — с годом.
  const sameYear = dayKey.slice(0, 4) === todayKey.slice(0, 4);
  return keyToUtcNoon(dayKey)
    .toLocaleDateString("ru-RU", {
      timeZone: "UTC",
      day: "numeric",
      month: "long",
      ...(sameYear ? {} : { year: "numeric" }),
    })
    .replace(/ г\.$/, "");
}
