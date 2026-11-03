import type { DeductionRules } from "./deduction-rules.ts";
import { allocateSharedShortage, type ShiftWeight } from "./shared-shortage.ts";

export type PoolKind = "shared" | "department" | "personal";
export type PoolSource = {
  pool: PoolKind;
  /** Для "department" — id подразделения; для "personal" — id сотрудника; для "shared" — null. */
  key: string | null;
  /** Управленческая сумма источника: отрицательная — недостача, положительная — излишек. */
  amount: number;
  /** Устойчивый ID источника: акт инвентаризации или акт списания. */
  sourceRef: string;
};
export type MonthlyShortageInput = {
  sources: PoolSource[];
  config: DeductionRules;
  weights: ShiftWeight[];
  /** Источники, у которых пул не определён: непривязанный склад или неразнесённый акт. */
  unresolved: string[];
};
export type MonthlyShortagePool = {
  pool: PoolKind;
  key: string | null;
  net: number;
  chargeable: number;
  company: number;
  employees: number;
  allocations: Array<{ employeeId: string; amount: number }>;
};

const cents = (n: number) => Math.round(n * 100);

/**
 * Месячное сальдо по пулам. Внутри пула излишки гасят недостачи; между пулами —
 * никогда: положительное сальдо пула обнуляется и пропадает. Лимит заведения
 * действует только на общий пул.
 */
export function allocateMonthlyShortage(input: MonthlyShortageInput): {
  pools: MonthlyShortagePool[];
  total: number;
  company: number;
  employees: number;
  unresolved: string[];
  state: "disabled" | "incomplete" | "ready";
} {
  const { config, weights, unresolved } = input;

  // Группировка по (pool, key) в копейках: без накопления float-ошибок.
  const grouped = new Map<
    string,
    { pool: PoolKind; key: string | null; netCents: number }
  >();
  for (const s of input.sources) {
    // Пустая строка — не ключ: считаем её отсутствующей.
    const key = s.key === "" ? null : s.key;
    const k = `${s.pool}\u0000${key ?? ""}`;
    const g = grouped.get(k) ?? { pool: s.pool, key, netCents: 0 };
    g.netCents += cents(s.amount);
    grouped.set(k, g);
  }

  let incomplete = unresolved.length > 0 && config.enabled;
  const pools: MonthlyShortagePool[] = [];

  for (const g of grouped.values()) {
    const chargeableCents = Math.max(0, -g.netCents);
    const base = {
      pool: g.pool,
      key: g.key,
      net: g.netCents / 100,
      chargeable: chargeableCents / 100,
    };
    const empty = { company: 0, employees: 0, allocations: [] };

    // Правила выключены: всё заведению, "неполным" месяц не считаем.
    if (!config.enabled) {
      pools.push({ ...base, ...empty, company: base.chargeable });
      continue;
    }
    if (unresolved.length > 0) {
      pools.push({ ...base, ...empty });
      continue;
    }
    // Пул без владельца (подразделение/сотрудник не указан) считать нельзя.
    if (g.pool !== "shared" && g.key === null) {
      incomplete = true;
      pools.push({ ...base, ...empty });
      continue;
    }
    if (g.pool === "personal") {
      pools.push({
        ...base,
        company: 0,
        employees: base.chargeable,
        allocations:
          chargeableCents > 0
            ? [{ employeeId: g.key!, amount: base.chargeable }]
            : [],
      });
      continue;
    }

    const cfg: DeductionRules =
      g.pool === "shared"
        ? config
        : { ...config, companyAllowance: 0, distribution: "shifts" };
    const poolWeights =
      g.pool === "shared"
        ? weights
        : weights.filter((x) => x.departmentId === g.key);
    const r = allocateSharedShortage(base.chargeable, cfg, poolWeights);
    // "period_required" (легаси split: "pending") никогда не считаем готовым.
    if (r.state === "incomplete" || r.state === "period_required") {
      incomplete = true;
      pools.push({ ...base, ...empty });
      continue;
    }
    pools.push({
      ...base,
      company: r.company ?? 0,
      employees: r.employees ?? 0,
      allocations: r.allocations,
    });
  }

  // Порядок результата не зависит от порядка источников.
  pools.sort(
    (a, b) =>
      a.pool.localeCompare(b.pool) || (a.key ?? "").localeCompare(b.key ?? ""),
  );

  if (incomplete) {
    // Без распределения: ничего не раздаём, пока месяц не полон.
    const total = pools.reduce((s, p) => s + cents(p.chargeable), 0) / 100;
    return {
      pools: pools.map((p) => ({
        ...p,
        company: 0,
        employees: 0,
        allocations: [],
      })),
      total,
      company: 0,
      employees: 0,
      unresolved: [...unresolved],
      state: "incomplete",
    };
  }

  const sumOf = (f: (p: MonthlyShortagePool) => number) =>
    pools.reduce((s, p) => s + cents(f(p)), 0) / 100;
  return {
    pools,
    total: sumOf((p) => p.chargeable),
    company: sumOf((p) => p.company),
    employees: sumOf((p) => p.employees),
    unresolved: [...unresolved],
    state: config.enabled ? "ready" : "disabled",
  };
}
