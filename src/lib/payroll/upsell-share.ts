// Доля сотрудника в допродажах подразделения (расчёт по чекам, sales_upsell_days).
// Чистые функции: без доступа к базе, чтобы зарплата и тесты считали одинаково.

/** Прежние должности с допродажами: у них переключатель включён по умолчанию. */
const LEGACY_EXTRAS_ROLES = ["Мастер", "Бармен"];

/**
 * Положены ли сотруднику допродажи по действующим условиям оплаты.
 * Явный `extras_enabled` решает всегда; без него — только «Бармен» и «Мастер»,
 * как было до правил по подразделениям.
 */
export function extrasEligible(
  config: { extras_enabled?: boolean } | null | undefined,
  roleName: string,
): boolean {
  if (typeof config?.extras_enabled === "boolean") return config.extras_enabled;
  return LEGACY_EXTRAS_ROLES.includes(roleName);
}

export type DepartmentShare = { amount: number | null; divisor: number };

/**
 * По каждому присутствующему сотруднику:
 * - `"legacy"` — его подразделение на эту дату ещё не перешло (или подразделения нет):
 *   прежний расчёт по названию должности;
 * - `null` — подразделение перешло, но допродажи сотруднику не положены;
 * - доля — сумма дня подразделения (`null`, если день не посчитан) и делитель —
 *   число присутствующих сотрудников подразделения, которым допродажи положены.
 */
export function departmentShares(input: {
  date: string;
  present: { id: string; departmentId: string | null; eligible: boolean }[];
  switchDates: Map<string, string>;
  days: Map<string, number | null>;
}): Map<string, DepartmentShare | "legacy" | null> {
  const switched = (departmentId: string | null): departmentId is string => {
    if (!departmentId) return false;
    const from = input.switchDates.get(departmentId);
    return from !== undefined && from <= input.date;
  };
  const divisors = new Map<string, number>();
  for (const p of input.present)
    if (switched(p.departmentId) && p.eligible)
      divisors.set(p.departmentId, (divisors.get(p.departmentId) ?? 0) + 1);
  const result = new Map<string, DepartmentShare | "legacy" | null>();
  for (const p of input.present) {
    if (!switched(p.departmentId)) result.set(p.id, "legacy");
    else if (!p.eligible) result.set(p.id, null);
    else
      result.set(p.id, {
        amount: input.days.get(p.departmentId) ?? null,
        divisor: divisors.get(p.departmentId)!,
      });
  }
  return result;
}

/** Сумма готового дня подразделения; строка не готова или результат испорчен — `null`. */
export function readyUpsellBonus(row: { state: string; result: unknown } | null | undefined): number | null {
  if (!row || row.state !== "ready") return null;
  const bonus = (row.result as { bonus?: unknown } | null)?.bonus;
  return typeof bonus === "number" && Number.isFinite(bonus) ? bonus : null;
}

/**
 * Дни, где допродажи подразделения посчитаны позже зарплаты: зарплату нужно
 * пересчитать. Зарплата дня, которая уже в очереди или считается, не трогается.
 */
export function staleUpsellPayrollDays(
  upsellDays: { business_date: string; state: string; computed_at: string | null }[],
  payrollDays: { business_date: string; state: string; synced_at: string | null }[],
): string[] {
  const payroll = new Map(payrollDays.map((d) => [d.business_date, d]));
  const dates = new Set<string>();
  for (const u of upsellDays) {
    if (u.state !== "ready" || !u.computed_at) continue;
    const p = payroll.get(u.business_date);
    if (p && (p.state === "loading" || p.state === "pending")) continue;
    if (!p?.synced_at || Date.parse(u.computed_at) > Date.parse(p.synced_at)) dates.add(u.business_date);
  }
  return [...dates].sort();
}
