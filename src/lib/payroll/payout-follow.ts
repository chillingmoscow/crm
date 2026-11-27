// План выплат наличными: день выплаты идёт за графиком (Павел, 27.11).
//
// Наличные выдают на смене, поэтому план ставит день выплаты на смену
// сотрудника. Но график меняется после утверждения: замены, новые смены,
// снятые смены. Без сверки выплата оставалась на дне, когда человека нет, а
// вышедший на замену без дня в плане ничего не получал. Сверка переносит
// только день, который поставил сам план; день, выбранный человеком, —
// сознательное решение (например, придёт за деньгами без смены), его не
// трогаем. Чистый модуль — проверяется `node --test`.

export type FollowRow = {
  id: string;
  employee_id: string;
  pay_date: string | null;
  /** День выбрали руками в плане — сверка его не переносит. */
  pay_date_manual: boolean;
  amount: number;
  issued: number;
  state: "planned" | "partial" | "issued";
};

export type FollowMove = { row_id: string; employee_id: string; from: string | null; to: string | null };

/**
 * Какие строки плана перенести на другой день, чтобы выдача шла на смене:
 * - день на смене (сегодня или позже) — остаётся;
 * - день без смены (замена, смену сняли) или дня нет — ближайшая смена
 *   сотрудника в окне плана, начиная с сегодняшнего дня; смен нет — без дня;
 * - прошедший невыданный день («Пропущено») — тоже на ближайшую смену; если
 *   смен впереди нет, остаётся как был.
 * Выданные, нулевые и строки с ручным днём не трогаем.
 */
export function followScheduleDays(
  rows: FollowRow[],
  shifts: { employee_id: string; business_date: string }[],
  today: string,
  window: { from: string; to: string },
): FollowMove[] {
  const from = today > window.from ? today : window.from;
  const daysOf = new Map<string, string[]>();
  for (const shift of shifts) {
    if (shift.business_date < from || shift.business_date > window.to) continue;
    const days = daysOf.get(shift.employee_id) ?? [];
    if (!days.includes(shift.business_date)) days.push(shift.business_date);
    daysOf.set(shift.employee_id, days);
  }
  const moves: FollowMove[] = [];
  for (const row of rows) {
    if (row.pay_date_manual || row.state === "issued" || row.amount <= 0 || row.issued >= row.amount) continue;
    const days = (daysOf.get(row.employee_id) ?? []).sort();
    if (row.pay_date && row.pay_date >= today && days.includes(row.pay_date)) continue;
    const next = days[0] ?? null;
    // Пропущенный день без смен впереди: переносить некуда, остаётся «Пропущено».
    if (row.pay_date && row.pay_date < today && next === null) continue;
    if (next === row.pay_date) continue;
    moves.push({ row_id: row.id, employee_id: row.employee_id, from: row.pay_date, to: next });
  }
  return moves;
}
