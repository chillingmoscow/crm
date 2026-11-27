import type { AuditEventInput } from "../audit/write.ts";

/** Один элемент результата `payroll_official_run` (миграция 384). */
export type OfficialRunItem = {
  account_id: string;
  venue_id: string | null;
  month: string;
  posted: number;
  review: number;
  /** Сколько из проведённых — записи «Получено через агентство» (398). */
  agency?: number;
  amount: number;
  errors?: { employment_id?: string; message?: string }[];
  /** Заведение упало целиком. */
  error?: string;
};

export type OfficialRunOutcome = {
  events: AuditEventInput[];
  /** Хоть одно заведение или сотрудник отработали с ошибкой. */
  failed: boolean;
  totals: { venues: number; posted: number; review: number; amount: number; errors: number };
};

function isItem(value: unknown): value is OfficialRunItem {
  return typeof value === "object" && value !== null && typeof (value as OfficialRunItem).account_id === "string";
}

/**
 * Превращает ответ RPC в строки журнала и признак сбоя. Одна строка на
 * заведение (с выплатами, карточками «На разбор» или ошибками); любая ошибка —
 * `failed`, чтобы маршрут ответил 500 и хостовой cron/мониторинг это заметил.
 */
export function processOfficialRun(raw: unknown): OfficialRunOutcome {
  const items = Array.isArray(raw) ? raw.filter(isItem) : [];
  const events: AuditEventInput[] = [];
  const totals = { venues: 0, posted: 0, review: 0, amount: 0, errors: 0 };
  let failed = false;

  for (const item of items) {
    const posted = Number(item.posted) || 0;
    const review = Number(item.review) || 0;
    const agency = Number(item.agency) || 0;
    const amount = Number(item.amount) || 0;
    const errors = Array.isArray(item.errors) ? item.errors : [];
    const venueError = typeof item.error === "string" && item.error ? item.error : null;
    const hasErrors = errors.length > 0 || venueError !== null;
    if (posted + review === 0 && !hasErrors) continue;

    totals.venues += 1;
    totals.posted += posted;
    totals.review += review;
    totals.amount += amount;
    totals.errors += errors.length + (venueError ? 1 : 0);
    if (hasErrors) failed = true;

    const details: Record<string, unknown> = { month: item.month, posted, review, amount };
    if (agency > 0) details.agency = agency;
    if (errors.length > 0) details.errors = errors;
    if (venueError) details.error = venueError;
    events.push({
      accountId: item.account_id,
      venueId: item.venue_id ?? null,
      userId: null,
      actionCode: "payroll.official_run.created",
      entityType: "payroll_official_run",
      entityId: null,
      details,
    });
  }
  return { events, failed, totals };
}
