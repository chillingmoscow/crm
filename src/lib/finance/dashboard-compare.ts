/**
 * С чем сравнивать итоги периода на финансовом дашборде: прошлый период той же
 * длины и тот же период год назад.
 *
 * Идущий период сравнивается честно — по одинаковому числу прошедших дней:
 * 1–21 ноября против 1–21 октября, а не против всего октября (иначе любой
 * незаконченный месяц выглядел бы провалом). Чистые функции без React и
 * Supabase, как и `dashboard-period.ts`.
 */

import {
  isoDay,
  parseIsoDay,
  periodLabel,
  shiftPeriod,
  wholeMonths,
  type DashboardPeriod,
} from "./dashboard-period.ts";

export type ComparisonWindow = {
  period: DashboardPeriod;
  /** Подпись после «к»: «октябрю», «ноябрю 2025», «1–21 октября». */
  label: string;
};

export type Comparisons = {
  /**
   * Последний день, по который считается текущий период для сравнения;
   * `null` — период закончился и сравнивается целиком.
   */
  cutoff: string | null;
  /** `null`, когда совпадает с `lastYear` (период — ровно год). */
  previous: ComparisonWindow | null;
  lastYear: ComparisonWindow;
};

const MONTHS_DATIVE = [
  "январю", "февралю", "марту", "апрелю", "маю", "июню",
  "июлю", "августу", "сентябрю", "октябрю", "ноябрю", "декабрю",
];

function daysBetween(a: Date, b: Date): number {
  return Math.round(
    (Date.UTC(b.getFullYear(), b.getMonth(), b.getDate()) -
      Date.UTC(a.getFullYear(), a.getMonth(), a.getDate())) /
      86_400_000,
  );
}

/** Тот же день год назад; 29 февраля → 28 февраля. */
function yearAgo(iso: string): Date {
  const d = parseIsoDay(iso)!;
  const y = d.getFullYear() - 1;
  const last = new Date(y, d.getMonth() + 1, 0).getDate();
  return new Date(y, d.getMonth(), Math.min(d.getDate(), last));
}

function isMonthEnd(iso: string): boolean {
  const d = parseIsoDay(iso)!;
  return new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate() === d.getDate();
}

function shiftYear(period: DashboardPeriod): DashboardPeriod {
  const to = parseIsoDay(period.to)!;
  return {
    from: isoDay(yearAgo(period.from)),
    // Конец месяца остаётся концом месяца: февраль 2028 → весь февраль 2027.
    to: isMonthEnd(period.to)
      ? isoDay(new Date(to.getFullYear() - 1, to.getMonth() + 1, 0))
      : isoDay(yearAgo(period.to)),
  };
}

/** Первые `days` дней окна (не дальше его конца). */
function truncate(period: DashboardPeriod, days: number): DashboardPeriod {
  const from = parseIsoDay(period.from)!;
  const end = isoDay(new Date(from.getFullYear(), from.getMonth(), from.getDate() + days - 1));
  return { from: period.from, to: end < period.to ? end : period.to };
}

/**
 * Подпись окна в дательном падеже для «+12% к …». Целый месяц, квартал и год
 * называются словами; отрезок дней — датами. Год пишется, только если он не
 * тот же, что у текущего периода.
 */
export function comparisonLabel(
  window: DashboardPeriod,
  base: DashboardPeriod,
  truncated: boolean,
): string {
  const a = parseIsoDay(window.from)!;
  const b = parseIsoDay(window.to)!;
  const baseYear = parseIsoDay(base.from)!.getFullYear();
  const year = (d: Date) => (d.getFullYear() !== baseYear ? ` ${d.getFullYear()}` : "");
  const months = truncated ? null : wholeMonths(window);
  if (months === 1) return `${MONTHS_DATIVE[a.getMonth()]}${year(a)}`;
  if (months === 3 && a.getMonth() % 3 === 0)
    return `${a.getMonth() / 3 + 1} кварталу${year(a)}`;
  if (months === 12 && a.getMonth() === 0) return `${a.getFullYear()} году`;
  if (months !== null)
    return a.getFullYear() === b.getFullYear()
      ? `${MONTHS_DATIVE[a.getMonth()]} – ${MONTHS_DATIVE[b.getMonth()]}${year(b)}`
      : `${MONTHS_DATIVE[a.getMonth()]} ${a.getFullYear()} – ${MONTHS_DATIVE[b.getMonth()]} ${b.getFullYear()}`;
  // Отрезок дней: «1–21 октября», «28 октября – 3 ноября». periodLabel
  // дописывает год по «сегодня», а здесь он нужен по текущему периоду.
  return periodLabel(window, new Date(baseYear, 0, 1));
}

/**
 * Окна сравнения для периода. `null` — период ещё не начался, сравнивать
 * нечего.
 */
export function comparisonWindows(
  period: DashboardPeriod,
  today: Date = new Date(),
): Comparisons | null {
  const todayIso = isoDay(today);
  if (period.from > todayIso) return null;

  const cutoff = period.to > todayIso ? todayIso : null;
  const elapsed = cutoff
    ? daysBetween(parseIsoDay(period.from)!, parseIsoDay(cutoff)!) + 1
    : null;

  const prevFull = shiftPeriod(period, -1);
  const yearFull = shiftYear(period);
  const prev = elapsed ? truncate(prevFull, elapsed) : prevFull;
  const year = elapsed ? truncate(yearFull, elapsed) : yearFull;
  const truncated = elapsed !== null;

  const same = prev.from === year.from && prev.to === year.to;
  return {
    cutoff,
    previous: same
      ? null
      : { period: prev, label: comparisonLabel(prev, period, truncated) },
    lastYear: { period: year, label: comparisonLabel(year, period, truncated) },
  };
}

/**
 * Изменение в долях (0.12 = +12%). `null`, если сравнивать не с чем: в окне
 * сравнения не было операций или база не положительная.
 */
export function relativeChange(current: number, previous: number): number | null {
  if (!(previous > 0)) return null;
  return (current - previous) / previous;
}

/** «+12%», «−8%», «0%», «+<1%». Минус типографский. */
export function formatChange(change: number): string {
  const pct = Math.abs(change) * 100;
  const sign = change > 0 ? "+" : change < 0 ? "−" : "";
  if (pct > 0 && pct < 1) return `${sign}<1%`;
  return `${sign}${Math.round(pct).toLocaleString("ru-RU")}%`;
}

/** С чем сравнивать — выбор на дашборде. */
export type CompareMode = "previous" | "year";

/** Значение из адреса страницы; всё незнакомое — сравнение с прошлым периодом. */
export function parseCompareMode(value: string | null | undefined): CompareMode {
  return value === "year" ? "year" : "previous";
}

/**
 * Подпись варианта «прошлый период» в переключателе: «Прошлый месяц»,
 * «Прошлый квартал» (календарный), «Прошлая неделя», для остального — «Прошлый
 * период».
 */
export function previousPeriodLabel(period: DashboardPeriod): string {
  const months = wholeMonths(period);
  const a = parseIsoDay(period.from)!;
  if (months === 1) return "Прошлый месяц";
  // Квартал — только календарный: сентябрь–ноябрь сравнивается с
  // июнем–августом, а это не «прошлый квартал».
  if (months === 3 && a.getMonth() % 3 === 0) return "Прошлый квартал";
  const b = parseIsoDay(period.to)!;
  // Неделя с понедельника по воскресенье.
  if (daysBetween(a, b) === 6 && a.getDay() === 1) return "Прошлая неделя";
  return "Прошлый период";
}

