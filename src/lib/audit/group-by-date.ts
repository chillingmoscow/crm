import type { AuditEvent } from "@/lib/audit/list";

export interface AuditGroup {
  /** Ключ дня — `YYYY-MM-DD` в локальной таймзоне. Стабилен для key prop. */
  dayKey: string;
  /** Заголовок секции: «Сегодня» / «Вчера» / «5 мая 2026». */
  title: string;
  events: AuditEvent[];
}

/** Группирует события по дню (локальная таймзона) в порядке убывания
 *  даты. Не сортирует события внутри группы — предполагается, что вход
 *  уже отсортирован по `created_at DESC`. */
export function groupEventsByDate(events: AuditEvent[]): AuditGroup[] {
  if (events.length === 0) return [];

  const groups: AuditGroup[] = [];
  let current: AuditGroup | null = null;

  const today = startOfDay(new Date());
  const yesterday = startOfDay(new Date(today.getTime() - 24 * 60 * 60 * 1000));

  for (const event of events) {
    const d = startOfDay(new Date(event.created_at));
    const dayKey = formatDayKey(d);
    if (!current || current.dayKey !== dayKey) {
      current = {
        dayKey,
        title: titleForDay(d, today, yesterday),
        events: [],
      };
      groups.push(current);
    }
    current.events.push(event);
  }

  return groups;
}

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function formatDayKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function titleForDay(d: Date, today: Date, yesterday: Date): string {
  if (d.getTime() === today.getTime()) return "Сегодня";
  if (d.getTime() === yesterday.getTime()) return "Вчера";
  // Текущий год — без года в заголовке (короче). Другой год — с годом.
  const sameYear = d.getFullYear() === today.getFullYear();
  return d.toLocaleDateString("ru-RU", {
    day: "numeric",
    month: "long",
    ...(sameYear ? {} : { year: "numeric" }),
  });
}
