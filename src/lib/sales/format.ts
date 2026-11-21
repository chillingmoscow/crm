const amount = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 2 });
const whole = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 0 });
const share = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 1 });
const quantity = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 2 });

/**
 * Число с копейками без знака валюты — только там, где точность важна сама по
 * себе: поля исправления показателей и «было → стало» в истории. На экранах
 * суммы выводит `Money` (целые, ₽ серым).
 */
export const money = (n: number | null) =>
  n === null ? "—" : amount.format(n);

/** Количество (чеки, гости, смены): целое с разрядами, «—» без значения. */
export const formatCount = (n: number | null | undefined) =>
  n == null || !Number.isFinite(n) ? "—" : whole.format(n);

/** Доля: «12,5 %», «—» без значения. */
export const formatShare = (n: number | null | undefined) =>
  n == null || !Number.isFinite(n) ? "—" : `${share.format(n)} %`;

/** Дробное количество (порции, баллы): до двух знаков, «—» без значения. */
export const formatQuantity = (n: number | null | undefined) =>
  n == null || !Number.isFinite(n) ? "—" : quantity.format(n);

/** «2026-11-21» → «пятница». */
export const weekdayLabel = (date: string) =>
  new Intl.DateTimeFormat("ru-RU", { weekday: "long", timeZone: "UTC" }).format(
    new Date(`${date}T12:00:00Z`),
  );

/** «2026-11» → «ноябрь 2026». */
export const monthLabel = (month: string) =>
  new Intl.DateTimeFormat("ru-RU", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  })
    .format(new Date(`${month.slice(0, 7)}-01T12:00:00Z`))
    .replace(/\s?г\.$/, "");

/**
 * «21 ноября 2026» — полная дата дня продаж. Для заголовков, где год важен
 * (день из архива, ссылки на прошлые смены). В лентах и подписях — короткие
 * `formatDayMonth` из `@/lib/format/date`.
 */
export const dayLabel = (date: string) =>
  new Intl.DateTimeFormat("ru-RU", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  })
    .format(new Date(`${date}T12:00:00Z`))
    .replace(/\s?г\.$/, "");
