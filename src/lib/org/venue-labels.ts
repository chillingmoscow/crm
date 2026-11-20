import { CURRENCIES, TIMEZONES, VENUE_TYPES } from "@/lib/constants";

/** Подписи заведения для интерфейса: список, карточка, архив. */

const TYPE_LABELS: Record<string, string> = Object.fromEntries(
  VENUE_TYPES.map((t) => [t.value, t.label]),
);

export function venueTypeLabel(type: string): string {
  return TYPE_LABELS[type] ?? type;
}

/**
 * «Москва, Санкт-Петербург (UTC+3)» вместо «Europe/Moscow»: технических
 * идентификаторов в интерфейсе нет (DS «Тексты»).
 */
export function timezoneLabel(tz: string): string {
  const known = TIMEZONES.find((t) => t.value === tz);
  if (!known) return tz;
  const [offset, city] = known.label.split(" — ");
  return city ? `${city} (${offset})` : offset;
}

/** Варианты часового пояса для выбора: «Москва, Санкт-Петербург (UTC+3)». */
export const TIMEZONE_OPTIONS = TIMEZONES.map((t) => ({
  value: t.value as string,
  label: timezoneLabel(t.value),
}));

export const CURRENCY_OPTIONS = CURRENCIES.map((c) => ({
  value: c.value as string,
  label: c.label as string,
}));

export const VENUE_TYPE_OPTIONS = VENUE_TYPES.map((t) => ({
  value: t.value as string,
  label: t.label as string,
}));
