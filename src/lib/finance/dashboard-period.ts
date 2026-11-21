/**
 * Период финансового дашборда: календарные дни `YYYY-MM-DD` включительно.
 *
 * Чистые функции без React и Supabase — их делят страница (сервер) и выбор
 * периода (клиент), а тесты гоняют их без окружения. Даты считаются в
 * локальном календаре: «сегодня» — это день пользователя, а не UTC.
 */

export type DashboardPeriod = { from: string; to: string };

const ISO = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Локальный календарный день `YYYY-MM-DD`. */
export function isoDay(d: Date): string {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

/** `YYYY-MM-DD` → локальная полночь; `null` для мусора и несуществующих дат. */
export function parseIsoDay(value: string | null | undefined): Date | null {
  if (!value) return null;
  const m = ISO.exec(value);
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const date = new Date(y, mo - 1, d);
  // `2026-13-40` проходит регулярку, но Date молча переносит его в другой
  // месяц — такую дату отбрасываем, а не показываем чужой период.
  if (date.getFullYear() !== y || date.getMonth() !== mo - 1 || date.getDate() !== d)
    return null;
  return date;
}

function addDays(d: Date, n: number): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
}

function monthStart(d: Date, offset = 0): Date {
  return new Date(d.getFullYear(), d.getMonth() + offset, 1);
}

function monthEnd(d: Date, offset = 0): Date {
  return new Date(d.getFullYear(), d.getMonth() + offset + 1, 0);
}

/** Период по умолчанию — текущий месяц. */
export function defaultPeriod(today: Date = new Date()): DashboardPeriod {
  return { from: isoDay(monthStart(today)), to: isoDay(monthEnd(today)) };
}

/**
 * Период из адреса страницы. Битая или пустая граница — период по умолчанию
 * целиком (половина диапазона из адреса и половина «по умолчанию» дала бы
 * неожиданный период). Перепутанные границы меняются местами.
 */
export function resolvePeriod(
  from: string | null | undefined,
  to: string | null | undefined,
  today: Date = new Date(),
): { period: DashboardPeriod; isDefault: boolean } {
  const a = parseIsoDay(from);
  const b = parseIsoDay(to);
  const fallback = defaultPeriod(today);
  if (!a || !b) return { period: fallback, isDefault: true };
  const [start, end] = a <= b ? [a, b] : [b, a];
  const period = { from: isoDay(start), to: isoDay(end) };
  return {
    period,
    isDefault: period.from === fallback.from && period.to === fallback.to,
  };
}

/** Сколько целых месяцев покрывает период; `null`, если он не по границам месяцев. */
export function wholeMonths(period: DashboardPeriod): number | null {
  const a = parseIsoDay(period.from);
  const b = parseIsoDay(period.to);
  if (!a || !b || a.getDate() !== 1) return null;
  if (isoDay(monthEnd(b)) !== period.to) return null;
  return (b.getFullYear() - a.getFullYear()) * 12 + (b.getMonth() - a.getMonth()) + 1;
}

function dayCount(period: DashboardPeriod): number {
  const a = parseIsoDay(period.from)!;
  const b = parseIsoDay(period.to)!;
  // Через Date.UTC, а не разницу миллисекунд: переход на летнее время
  // дал бы 23- или 25-часовой день.
  return (
    Math.round(
      (Date.UTC(b.getFullYear(), b.getMonth(), b.getDate()) -
        Date.UTC(a.getFullYear(), a.getMonth(), a.getDate())) /
        86_400_000,
    ) + 1
  );
}

/**
 * Соседний период той же длины: месяц → месяц, квартал → квартал, год → год,
 * произвольные N дней → N дней. Стрелки `PeriodStepper` шагают этим.
 */
export function shiftPeriod(period: DashboardPeriod, direction: -1 | 1): DashboardPeriod {
  const a = parseIsoDay(period.from)!;
  const months = wholeMonths(period);
  if (months !== null) {
    const start = monthStart(a, direction * months);
    return { from: isoDay(start), to: isoDay(monthEnd(start, months - 1)) };
  }
  const days = dayCount(period);
  return {
    from: isoDay(addDays(a, direction * days)),
    to: isoDay(addDays(parseIsoDay(period.to)!, direction * days)),
  };
}

/** Период содержит этот день. */
export function periodContains(period: DashboardPeriod, day: Date = new Date()): boolean {
  const iso = isoDay(day);
  return period.from <= iso && iso <= period.to;
}

/** Следующий день после `iso` — исключающая граница фильтра по дате операции. */
export function nextIsoDay(iso: string): string {
  return isoDay(addDays(parseIsoDay(iso)!, 1));
}

const MONTHS_GENITIVE = [
  "января", "февраля", "марта", "апреля", "мая", "июня",
  "июля", "августа", "сентября", "октября", "ноября", "декабря",
];
const MONTHS_NOMINATIVE = [
  "январь", "февраль", "март", "апрель", "май", "июнь",
  "июль", "август", "сентябрь", "октябрь", "ноябрь", "декабрь",
];

/**
 * Подпись периода в шапке: «ноябрь 2026», «3 квартал 2026», «2026 год»,
 * «16–22 ноября», «28 октября – 3 ноября», «21 ноября». Год у дней
 * дописывается, только если период не в текущем году.
 */
export function periodLabel(period: DashboardPeriod, today: Date = new Date()): string {
  const a = parseIsoDay(period.from)!;
  const b = parseIsoDay(period.to)!;
  const months = wholeMonths(period);
  if (months === 1) return `${MONTHS_NOMINATIVE[a.getMonth()]} ${a.getFullYear()}`;
  if (months === 3 && a.getMonth() % 3 === 0)
    return `${a.getMonth() / 3 + 1} квартал ${a.getFullYear()}`;
  if (months === 12 && a.getMonth() === 0) return `${a.getFullYear()} год`;

  const sameYear = a.getFullYear() === b.getFullYear();
  const showYear = !sameYear || a.getFullYear() !== today.getFullYear();
  const yearSuffix = (d: Date) => (showYear ? ` ${d.getFullYear()}` : "");

  if (months !== null) {
    // Несколько целых месяцев: «сентябрь – ноябрь 2026».
    return sameYear
      ? `${MONTHS_NOMINATIVE[a.getMonth()]} – ${MONTHS_NOMINATIVE[b.getMonth()]} ${b.getFullYear()}`
      : `${MONTHS_NOMINATIVE[a.getMonth()]} ${a.getFullYear()} – ${MONTHS_NOMINATIVE[b.getMonth()]} ${b.getFullYear()}`;
  }
  if (period.from === period.to)
    return `${a.getDate()} ${MONTHS_GENITIVE[a.getMonth()]}${yearSuffix(a)}`;
  if (sameYear && a.getMonth() === b.getMonth())
    return `${a.getDate()}–${b.getDate()} ${MONTHS_GENITIVE[b.getMonth()]}${yearSuffix(b)}`;
  if (sameYear)
    return `${a.getDate()} ${MONTHS_GENITIVE[a.getMonth()]} – ${b.getDate()} ${MONTHS_GENITIVE[b.getMonth()]}${yearSuffix(b)}`;
  return `${a.getDate()} ${MONTHS_GENITIVE[a.getMonth()]} ${a.getFullYear()} – ${b.getDate()} ${MONTHS_GENITIVE[b.getMonth()]} ${b.getFullYear()}`;
}

export type PeriodPreset = { label: string; range: (today: Date) => DashboardPeriod };

function weekStart(d: Date): Date {
  return addDays(d, -((d.getDay() + 6) % 7));
}

function quarterStart(d: Date, offset = 0): Date {
  return new Date(d.getFullYear(), Math.floor(d.getMonth() / 3) * 3 + offset * 3, 1);
}

/** Быстрый выбор в меню периода — в порядке частоты. */
export const PERIOD_PRESETS: PeriodPreset[] = [
  { label: "Этот месяц", range: (t) => defaultPeriod(t) },
  {
    label: "Прошлый месяц",
    range: (t) => ({ from: isoDay(monthStart(t, -1)), to: isoDay(monthEnd(t, -1)) }),
  },
  {
    label: "Эта неделя",
    range: (t) => ({ from: isoDay(weekStart(t)), to: isoDay(addDays(weekStart(t), 6)) }),
  },
  {
    label: "Последние 30 дней",
    range: (t) => ({ from: isoDay(addDays(t, -29)), to: isoDay(t) }),
  },
  {
    label: "Этот квартал",
    range: (t) => ({ from: isoDay(quarterStart(t)), to: isoDay(addDays(quarterStart(t, 1), -1)) }),
  },
  {
    label: "Этот год",
    range: (t) => ({
      from: isoDay(new Date(t.getFullYear(), 0, 1)),
      to: isoDay(new Date(t.getFullYear(), 11, 31)),
    }),
  },
  {
    label: "Прошлый год",
    range: (t) => ({
      from: isoDay(new Date(t.getFullYear() - 1, 0, 1)),
      to: isoDay(new Date(t.getFullYear() - 1, 11, 31)),
    }),
  },
];
