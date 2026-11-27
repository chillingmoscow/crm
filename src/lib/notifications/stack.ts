/**
 * Стопки однотипных уведомлений одного дня («13 новых анкет»).
 *
 * Идём по списку в его порядке (новые сверху). Уведомления одного типа,
 * пришедшие в один календарный день, собираются в стопку на месте самого
 * нового из них; одиночное остаётся строкой. Порядок внутри стопки —
 * исходный.
 */

interface Stackable {
  id: string;
  type: string;
  created_at: string;
}

export type NotificationEntry<T extends Stackable> =
  | { kind: "single"; key: string; item: T }
  | { kind: "stack"; key: string; type: string; items: T[] };

/** Сколько одинаковых уведомлений за день собираются в стопку. */
export const STACK_MIN = 2;

/**
 * Календарный день: «2026-11-27». В поясе `timeZone`, без него — в поясе
 * браузера. Список рисует и сервер (он в UTC), поэтому страница передаёт пояс
 * аккаунта, и стопки в разметке и в браузере совпадают.
 */
export function localDayKey(iso: string, timeZone?: string): string {
  const d = new Date(iso);
  if (timeZone) {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(d);
    const part = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
    return `${part("year")}-${part("month")}-${part("day")}`;
  }
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${mm}-${dd}`;
}

export function stackNotifications<T extends Stackable>(
  items: T[],
  timeZone?: string,
): NotificationEntry<T>[] {
  const groups = new Map<string, T[]>();
  const order: string[] = [];
  for (const item of items) {
    const key = `${item.type}|${localDayKey(item.created_at, timeZone)}`;
    const group = groups.get(key);
    if (group) group.push(item);
    else {
      groups.set(key, [item]);
      order.push(key);
    }
  }
  return order.map((key) => {
    const group = groups.get(key)!;
    if (group.length < STACK_MIN) {
      return { kind: "single", key: group[0]!.id, item: group[0]! };
    }
    return { kind: "stack", key: `stack:${key}`, type: group[0]!.type, items: group };
  });
}

/**
 * Подпись людей или записей стопки: «Анна Белова, Пётр Орлов и ещё 11».
 * Пустые и повторяющиеся имена пропускаются.
 */
export function stackNamesPreview(names: Array<string | null | undefined>, shown = 2): string {
  const unique = [...new Set(names.map((n) => n?.trim()).filter((n): n is string => !!n))];
  if (unique.length <= shown) return unique.join(", ");
  return `${unique.slice(0, shown).join(", ")} и ещё ${unique.length - shown}`;
}
