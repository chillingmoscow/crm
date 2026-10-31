import {
  deductionRulesSchema,
  companyShortage,
  type DeductionRules,
} from "./deduction-rules";
export type ShiftWeight = {
  employeeId: string;
  roleId: string;
  shifts: number;
};
type Allocation = { employeeId: string; amount: number };
/** Exact integer allocation. Remainders follow a stable key, not query order. */
function distribute(
  cents: number,
  rows: { key: string; weight: number }[],
): Map<string, number> {
  const sum = rows.reduce((s, r) => s + BigInt(r.weight), BigInt(0));
  if (sum === BigInt(0)) return new Map();
  const parts = rows.map((r) => ({
    key: r.key,
    cents: Number((BigInt(cents) * BigInt(r.weight)) / sum),
    remainder: (BigInt(cents) * BigInt(r.weight)) % sum,
  }));
  let rest = cents - parts.reduce((s, r) => s + r.cents, 0);
  parts.sort((a, b) =>
    a.remainder === b.remainder
      ? a.key.localeCompare(b.key)
      : a.remainder > b.remainder
        ? -1
        : 1,
  );
  for (const p of parts) {
    if (rest-- <= 0) break;
    p.cents++;
  }
  return new Map(parts.map((p) => [p.key, p.cents]));
}
export function allocateSharedShortage(
  total: number | null,
  config: DeductionRules,
  weights: ShiftWeight[],
): {
  total: number | null;
  company: number | null;
  employees: number | null;
  allocated: number;
  unallocated: number | null;
  allocations: Allocation[];
  unassignedRoles: string[];
  state: "disabled" | "incomplete" | "period_required" | "ready";
} {
  const c = deductionRulesSchema.parse(config),
    scope = companyShortage(total, c.companyAllowance);
  const ids = new Set<string>();
  for (const w of weights) {
    const key = w.employeeId + ":" + w.roleId;
    if (
      !w.employeeId ||
      !w.roleId ||
      !Number.isSafeInteger(w.shifts) ||
      w.shifts < 0 ||
      w.shifts > 100000 ||
      ids.has(key)
    )
      throw new Error("Проверьте состав и количество смен");
    ids.add(key);
  }
  const base = {
    ...scope,
    allocated: 0,
    unallocated: scope.employees,
    allocations: [] as Allocation[],
    unassignedRoles: [] as string[],
  };
  if (!c.enabled)
    return {
      ...base,
      company: total,
      employees: 0,
      unallocated: 0,
      state: "disabled",
    };
  if (scope.employees === null) return { ...base, state: "incomplete" };
  if (scope.employees === 0) return { ...base, unallocated: 0, state: "ready" };
  const included = weights.filter(
    (w) => w.shifts > 0 && !c.excludedRoleIds.includes(w.roleId),
  );
  const result = new Map<string, number>(),
    pool = Math.round(scope.employees * 100);
  const add = (part: Map<string, number>) =>
    part.forEach((v, k) => result.set(k, (result.get(k) ?? 0) + v));
  const personWeights = (xs: ShiftWeight[]) => {
    const m = new Map<string, number>();
    for (const w of xs)
      m.set(w.employeeId, (m.get(w.employeeId) ?? 0) + w.shifts);
    return [...m].map(([key, weight]) => ({ key, weight }));
  };
  let unassignedRoles: string[] = [];
  if (c.distribution === "shifts")
    add(distribute(pool, personWeights(included)));
  else {
    const pools = distribute(
      pool,
      c.groups.map((g) => ({ key: g.id, weight: Math.round(g.share * 100) })),
    );
    unassignedRoles = [
      ...new Set(
        included
          .filter((w) => !c.groups.some((g) => g.roleIds.includes(w.roleId)))
          .map((w) => w.roleId),
      ),
    ].sort();
    for (const g of c.groups)
      add(
        distribute(
          pools.get(g.id) ?? 0,
          personWeights(included.filter((w) => g.roleIds.includes(w.roleId))),
        ),
      );
  }
  const allocated = [...result.values()].reduce((s, n) => s + n, 0),
    unallocated = pool - allocated;
  return {
    ...base,
    allocated: allocated / 100,
    unallocated: unallocated / 100,
    allocations: [...result]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([employeeId, amount]) => ({ employeeId, amount: amount / 100 })),
    unassignedRoles,
    state:
      unallocated > 0 || unassignedRoles.length
        ? "incomplete"
        : c.split === "pending"
          ? "period_required"
          : "ready",
  };
}
