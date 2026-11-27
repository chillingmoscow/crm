/**
 * «Обзор» базы знаний (спека «Обзор», «Решения по вопросам проверки»):
 * какие блоки видит человек и за какой период считаются показатели.
 * Чистые функции — без React и базы.
 */

export type KbOverviewBlocks = {
  /** Показатели (MetricStrip): аналитика. */
  metrics: boolean;
  /** «Требует внимания»: обязательное чтение. */
  attention: boolean;
  /** «Популярное за период»: аналитика. */
  popular: boolean;
  /** «По месяцам»: аналитика. */
  trend: boolean;
  /** «Последние изменения»: журнал. */
  changes: boolean;
  /** Вид «По страницам»: аналитика. */
  pagesView: boolean;
};

/** Каждый блок — при своём праве; блока без права нет, пустых мест не
 *  остаётся. Саму страницу открывает `canOpenKbOverview` (shell.ts). */
export function kbOverviewBlocks(perms: ReadonlySet<string>): KbOverviewBlocks {
  const analytics = perms.has("kb.view_analytics");
  return {
    metrics: analytics,
    attention: perms.has("kb.manage_required_reading"),
    popular: analytics,
    trend: analytics,
    changes: perms.has("org.view_audit"),
    pagesView: analytics,
  };
}

/** Неделя — с понедельника (`YYYY-MM-DD`), месяц — `YYYY-MM`. */
export type KbOverviewPeriod =
  | { kind: "week"; start: string }
  | { kind: "month"; start: string };

const DAY_MS = 24 * 60 * 60 * 1000;

function utcDate(day: string): Date {
  return new Date(`${day}T00:00:00.000Z`);
}

function isoDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function mondayOf(day: string): string {
  const date = utcDate(day);
  const shift = (date.getUTCDay() + 6) % 7;
  return isoDay(new Date(date.getTime() - shift * DAY_MS));
}

function monthStart(month: string): Date {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 1));
}

function monthKey(date: Date): string {
  return date.toISOString().slice(0, 7);
}

const DAY_RE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

/** Период из адреса (`?period=week|month&from=…`); без него или с мусором —
 *  текущая неделя / текущий месяц. `today` — `YYYY-MM-DD`. */
export function parseKbOverviewPeriod(
  params: { period?: string; from?: string },
  today: string,
): KbOverviewPeriod {
  if (params.period === "month") {
    const from = params.from && MONTH_RE.test(params.from) ? params.from : today.slice(0, 7);
    return { kind: "month", start: from };
  }
  const from = params.from && DAY_RE.test(params.from) ? params.from : today;
  return { kind: "week", start: mondayOf(from) };
}

export function shiftKbOverviewPeriod(period: KbOverviewPeriod, delta: number): KbOverviewPeriod {
  if (period.kind === "week") {
    return { kind: "week", start: isoDay(new Date(utcDate(period.start).getTime() + delta * 7 * DAY_MS)) };
  }
  const start = monthStart(period.start);
  return {
    kind: "month",
    start: monthKey(new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + delta, 1))),
  };
}

/** Окно агрегации `[since, until)` по UTC — как остальная аналитика базы. */
export function kbOverviewWindow(period: KbOverviewPeriod): { sinceISO: string; untilISO: string } {
  if (period.kind === "week") {
    const since = utcDate(period.start);
    return {
      sinceISO: since.toISOString(),
      untilISO: new Date(since.getTime() + 7 * DAY_MS).toISOString(),
    };
  }
  const since = monthStart(period.start);
  return {
    sinceISO: since.toISOString(),
    untilISO: new Date(Date.UTC(since.getUTCFullYear(), since.getUTCMonth() + 1, 1)).toISOString(),
  };
}

/** Стрелка «вперёд» неактивна на текущем периоде — будущего нет. */
export function kbOverviewNextDisabled(period: KbOverviewPeriod, today: string): boolean {
  return kbOverviewWindow(period).untilISO > utcDate(today).toISOString();
}

const MONTHS_SHORT = ["янв.", "февр.", "мар.", "апр.", "мая", "июн.", "июл.", "авг.", "сент.", "окт.", "нояб.", "дек."];
const MONTHS = [
  "Январь", "Февраль", "Март", "Апрель", "Май", "Июнь",
  "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь",
];

/** «23–29 нояб. 2026», «30 нояб. – 6 дек. 2026», «Ноябрь 2026». */
export function kbOverviewPeriodLabel(period: KbOverviewPeriod): string {
  if (period.kind === "month") {
    const start = monthStart(period.start);
    return `${MONTHS[start.getUTCMonth()]} ${start.getUTCFullYear()}`;
  }
  const from = utcDate(period.start);
  const to = new Date(from.getTime() + 6 * DAY_MS);
  const year = to.getUTCFullYear();
  if (from.getUTCMonth() === to.getUTCMonth()) {
    return `${from.getUTCDate()}–${to.getUTCDate()} ${MONTHS_SHORT[to.getUTCMonth()]} ${year}`;
  }
  const fromYear = from.getUTCFullYear() === year ? "" : ` ${from.getUTCFullYear()}`;
  return `${from.getUTCDate()} ${MONTHS_SHORT[from.getUTCMonth()]}${fromYear} – ${to.getUTCDate()} ${MONTHS_SHORT[to.getUTCMonth()]} ${year}`;
}

export function kbOverviewPeriodQuery(period: KbOverviewPeriod): string {
  return `period=${period.kind}&from=${period.start}`;
}

/** Порог «давно не обновлялась»: 6 месяцев назад от `today` (решение строителя). */
export function kbOverviewStaleBefore(today: string): string {
  const date = utcDate(today);
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() - 6, date.getUTCDate())).toISOString();
}
