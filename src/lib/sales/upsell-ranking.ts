// Рейтинг сотрудников по прибавке за допродажи за месяц: из начислений
// зарплаты (строки «Дополнительные продажи»). Чистые функции, без базы.
import type { Component } from "@/lib/payroll/types";
import type { AdditionalKind } from "./additional.ts";

/** Ключ подразделения в рейтинге: id подразделения или старый вид («legacy:bar»). */
export const legacyGroup = (kind: AdditionalKind) => `legacy:${kind}`;

export type RankingAccrual = {
  employee_id: string;
  components: Component[];
  /** `calculation_snapshot.kind`: месячный оклад и корректировки — не смены. */
  kind?: string | null;
  /** `calculation_snapshot.extra_share.department_id` — доля по правилам подразделения. */
  department_id?: string | null;
  /** Должность из снимка расчёта: по ней делились допродажи до правил подразделений. */
  role?: string | null;
};

export type RankingEntry = {
  employeeId: string;
  /** Сумма прибавки за посчитанные смены. */
  amount: number;
  /** Смен с прибавкой этого подразделения. */
  shifts: number;
  /** Из них без суммы (допродажи дня не посчитаны) — в сумму не входят. */
  unknown: number;
};

const LEGACY_ROLES: Record<string, AdditionalKind> = { Бармен: "bar", Мастер: "masters" };

/** Подразделение, к которому относится прибавка смены; `null` — не определить. */
export function rankingGroup(a: RankingAccrual): string | null {
  if (a.department_id) return a.department_id;
  const kind = a.role ? LEGACY_ROLES[a.role] : undefined;
  return kind ? legacyGroup(kind) : null;
}

/**
 * Прибавка по сотрудникам и подразделениям. Смена без суммы прибавки
 * (`amount: null`) считается в `unknown` и в сумму не входит — неизвестное
 * не превращаем в ноль.
 */
export function buildUpsellRanking(accruals: RankingAccrual[]): Map<string, RankingEntry[]> {
  const groups = new Map<string, Map<string, RankingEntry>>();
  for (const a of accruals) {
    if (a.kind === "monthly" || a.kind === "adjustment") continue;
    const extras = a.components.filter((c) => c.kind === "extra");
    if (!extras.length) continue;
    const group = rankingGroup(a);
    if (!group) continue;
    const byEmployee = groups.get(group) ?? new Map<string, RankingEntry>();
    groups.set(group, byEmployee);
    const entry = byEmployee.get(a.employee_id) ?? {
      employeeId: a.employee_id,
      amount: 0,
      shifts: 0,
      unknown: 0,
    };
    entry.shifts += 1;
    const known = extras.every((c) => c.amount !== null && Number.isFinite(Number(c.amount)));
    if (known) entry.amount = Math.round((entry.amount + extras.reduce((s, c) => s + Number(c.amount), 0)) * 100) / 100;
    else entry.unknown += 1;
    byEmployee.set(a.employee_id, entry);
  }
  return new Map(
    [...groups].map(([group, entries]) => [
      group,
      [...entries.values()].sort((x, y) => y.amount - x.amount || y.shifts - x.shifts),
    ]),
  );
}
