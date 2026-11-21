/**
 * Сверка остатка счёта с банком — чистая логика без обращений к базе.
 *
 * Разница всегда «банк − расчёт»: плюс — в банке больше, чем по операциям.
 * Сравниваем в копейках: суммы приходят numeric(15,2), но float-арифметика
 * на клиенте даёт хвосты вроде 0.0000001.
 */

export type ReconciliationSource = "manual" | "bank";

export type ReconciliationRecord = {
  id: string;
  balance_date: string;
  bank_balance: number;
  /** Остаток по операциям на дату в момент сверки. */
  calculated_balance: number;
  /** Остаток по операциям на ту же дату сейчас; null — посчитать нельзя. */
  current_calculated_balance: number | null;
  source: ReconciliationSource;
  note: string | null;
  created_at: string;
  created_by: string | null;
  created_by_name: string | null;
};

export type ReconciliationSuspect = {
  id: string;
  public_id: number;
  date: string;
  amount: number;
  type: "income" | "expense" | "transfer";
  /** duplicate — сумма равна разнице; sign — двойная сумма равна разнице. */
  reason: "duplicate" | "sign";
};

export type ReconciliationSearch = {
  operations: number;
  suspects: ReconciliationSuspect[];
};

const kopecks = (value: number) => Math.round(value * 100);

/** Банк − расчёт, округлено до копеек. */
export function reconciliationDiff(bankBalance: number, calculatedBalance: number): number {
  return (kopecks(bankBalance) - kopecks(calculatedBalance)) / 100;
}

export function isMatched(diff: number): boolean {
  return kopecks(diff) === 0;
}

export type ReconciliationState = {
  /** Разница на момент сверки. */
  diff: number;
  matched: boolean;
  /** Операции до даты сверки потом поменялись: расчёт на дату уже другой. */
  changedSince: boolean;
  /** Разница сейчас (если операции менялись); null — посчитать нельзя. */
  currentDiff: number | null;
  currentMatched: boolean;
};

export function reconciliationState(row: ReconciliationRecord): ReconciliationState {
  const diff = reconciliationDiff(row.bank_balance, row.calculated_balance);
  const current = row.current_calculated_balance;
  const currentDiff = current === null ? null : reconciliationDiff(row.bank_balance, current);
  return {
    diff,
    matched: isMatched(diff),
    changedSince: current !== null && kopecks(current) !== kopecks(row.calculated_balance),
    currentDiff,
    currentMatched: currentDiff !== null && isMatched(currentDiff),
  };
}

/** Следующий календарный день `YYYY-MM-DD`. */
export function nextDay(day: string): string {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
}

/**
 * Период поиска расхождения на дату `day`: со дня после последней сверки,
 * которая сходится сейчас (её дата строго раньше `day`), по `day`
 * включительно. Нет такой сверки — с начала (`from: null`).
 */
export function searchWindow(
  rows: ReconciliationRecord[],
  day: string,
): { from: string | null; to: string; matchedOn: string | null } {
  let matchedOn: string | null = null;
  for (const row of rows) {
    if (row.balance_date >= day) continue;
    if (!reconciliationState(row).currentMatched) continue;
    if (!matchedOn || row.balance_date > matchedOn) matchedOn = row.balance_date;
  }
  return { from: matchedOn ? nextDay(matchedOn) : null, to: day, matchedOn };
}

/** Ссылка в «Транзакции»: операции счёта за период поиска. */
export function transactionsSearchHref(
  bankAccountId: string,
  window: { from: string | null; to: string },
): string {
  const params = new URLSearchParams({ bank_account_id: bankAccountId });
  if (window.from) params.set("date_from", window.from);
  params.set("date_to", window.to);
  return `/finance/transactions?${params.toString()}`;
}

/** Календарный день `YYYY-MM-DD` момента `now` в поясе (по умолчанию — сегодня). */
export function dayInZone(timeZone: string, now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/**
 * Остаток по выписке из поля ввода: «−1 234,56», «1234.5», пробелы и
 * неразрывные пробелы. null — не число или больше двух знаков после запятой.
 */
export function parseBankBalance(input: string): number | null {
  const normalized = input
    .replace(/[\s  ]/g, "")
    .replace(/−/g, "-")
    .replace(",", ".");
  if (!/^-?\d+(\.\d{1,2})?$/.test(normalized)) return null;
  const value = Number(normalized);
  if (!Number.isFinite(value) || Math.abs(value) >= 1e13) return null;
  return value;
}
