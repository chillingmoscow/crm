/** Shared additional-sales rules. A department pool is divided by the payroll
 * calculator; this module never posts employee bonuses or financial operations. */
export type AdditionalKind = "bar" | "masters";
export type AdditionalGroup = {
  id: string;
  label: string;
  branches: string[];
  rate: number;
};
export type AdditionalRules = {
  bar: AdditionalGroup[];
  masters: AdditionalGroup[];
  tiers: { from: number; rate: number }[];
};
export const defaultAdditionalRules: AdditionalRules = {
  bar: [
    {
      id: "tea",
      label: "Премиальный чай",
      branches: ["Премиальный чай"],
      rate: 100,
    },
    {
      id: "additions",
      label: "Добавки",
      branches: ["Ягоды и фрукты", "Добавки", "Сиропы к кофе", "Пюре"],
      rate: 20,
    },
    {
      id: "alcohol",
      label: "Крепкий алкоголь",
      branches: [
        "Виски",
        "Ром",
        "Джин",
        "Прочее / Алкоголь",
        "Мескаль / Текила",
      ],
      rate: 100,
    },
    {
      id: "wine_glass",
      label: "Вино, бокалы",
      branches: ["По бокалам"],
      rate: 100,
    },
    {
      id: "wine_bottle",
      label: "Вино, бутылки",
      branches: ["Белые вина", "Игристые вина", "Красные вина", "Розовые вина"],
      rate: 600,
    },
    {
      id: "cocktails",
      label: "Фирменные коктейли",
      branches: ["Фирменные коктейли"],
      rate: 180,
    },
    {
      id: "tinctures",
      label: "Настойки, порции",
      branches: ["Настойки"],
      rate: 20,
    },
    { id: "sets", label: "Сеты настоек", branches: ["Сет настоек"], rate: 200 },
    {
      id: "lemonade_glass",
      label: "Лимонады, бокалы",
      branches: ["Лимонад (бокал)"],
      rate: 20,
    },
    {
      id: "lemonade_jug",
      label: "Лимонады, графины",
      branches: ["Лимонад (графин)", "Лимонад-конструктор"],
      rate: 100,
    },
    {
      id: "signature_tea",
      label: "Авторский чай",
      branches: ["Авторский чай"],
      rate: 100,
    },
    {
      id: "constructor",
      label: "Коктейль-конструктор",
      branches: ["Коктейль-конструктор"],
      rate: 220,
    },
  ],
  masters: [
    {
      id: "premium",
      label: "Премиальный табак",
      branches: ["Премиальный табак"],
      rate: 0.5,
    },
    {
      id: "degust",
      label: "Дегустационные сеты",
      branches: ["Дегустация"],
      rate: 1.25,
    },
    {
      id: "exclusive",
      label: "Эксклюзивные кальяны",
      branches: ["Эксклюзивные кальяны"],
      rate: 2,
    },
  ],
  tiers: [
    { from: 3, rate: 150 },
    { from: 6, rate: 225 },
    { from: 9, rate: 300 },
  ],
};
export type AdditionalMetrics = {
  revenue: number;
  primeCost: number;
  bonus: number;
  points: number | null;
  quantities: Record<string, number | null>;
};
export type AdditionalRuleVersion = {
  id: string;
  valid_from: string;
  config: AdditionalRules;
  reason: string;
  created_at: string;
  created_by: string | null;
};
export type AdditionalDay = {
  id: string;
  venue_id: string;
  business_date: string;
  kind: AdditionalKind;
  metrics: AdditionalMetrics | null;
  request: { rules: AdditionalRules; rule_id: string };
  metrics_request: { rules: AdditionalRules; rule_id: string } | null;
  state: "pending" | "running" | "ready" | "error";
  last_error: string | null;
  synced_at: string | null;
  period_start: string | null;
  period_end: string | null;
};
export type AdditionalArchive = {
  id: string;
  venue_id: string;
  business_date: string;
  kind: AdditionalKind;
  metrics: AdditionalMetrics;
  captured_at: string;
  origin: {
    spreadsheet_id: string;
    ranges: string[];
    legacy_shift_id?: string;
  };
};
export type ReportRow = { type?: string; object: Record<string, unknown> };
export type AdditionalReport = {
  ds: ReportRow[];
  utilityData?: { aggregates?: Record<string, unknown> };
};
const round = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

export function validateAdditionalRules(rules: AdditionalRules) {
  for (const kind of ["bar", "masters"] as const) {
    if (
      !Array.isArray(rules[kind]) ||
      !rules[kind].length ||
      rules[kind].length > 40
    )
      throw new Error("Проверьте группы допродаж");
    const ids = new Set<string>(),
      branches = new Set<string>();
    for (const g of rules[kind]) {
      if (
        !/^[a-z][a-z0-9_]{0,39}$/.test(g.id) ||
        ids.has(g.id) ||
        ["date", "bonus", "points", "revenue", "quantities"].includes(g.id) ||
        !g.label.trim() ||
        g.label.length > 100 ||
        !Number.isFinite(g.rate) ||
        g.rate < 0 ||
        g.rate > 1000000 ||
        round(g.rate) !== g.rate ||
        !Array.isArray(g.branches) ||
        !g.branches.length
      )
        throw new Error("Проверьте названия и ставки допродаж");
      ids.add(g.id);
      for (const b of g.branches) {
        if (!b.trim() || b.length > 200 || branches.has(b))
          throw new Error("Категория допродаж повторяется или не заполнена");
        branches.add(b);
      }
    }
  }
  if (
    !Array.isArray(rules.tiers) ||
    !rules.tiers.length ||
    rules.tiers.length > 20
  )
    throw new Error("Проверьте шкалу баллов");
  const thresholds = new Set<number>();
  for (const t of rules.tiers) {
    if (
      !Number.isFinite(t.from) ||
      t.from < 0 ||
      round(t.from) !== t.from ||
      thresholds.has(t.from) ||
      !Number.isFinite(t.rate) ||
      t.rate < 0 ||
      t.rate > 1000000 ||
      round(t.rate) !== t.rate
    )
      throw new Error("Некорректная шкала баллов");
    thresholds.add(t.from);
  }
}
function finite(value: unknown, name: string): number {
  if (
    (typeof value !== "number" && typeof value !== "string") ||
    value === "" ||
    !Number.isFinite(Number(value))
  )
    throw new Error(`Quick Resto не вернул показатель «${name}»`);
  const n = Number(value);
  if (Math.abs(n) > 1e12)
    throw new Error(`Quick Resto вернул некорректный показатель «${name}»`);
  return n;
}
function rows(raw: unknown): AdditionalReport {
  if (
    !raw ||
    typeof raw !== "object" ||
    !Array.isArray((raw as AdditionalReport).ds) ||
    (raw as AdditionalReport).ds.length >= 10000
  )
    throw new Error("Quick Resto не вернул полный отчёт допродаж");
  const report = raw as AdditionalReport;
  if (report.ds.some((r) => !r || !r.object || typeof r.object !== "object"))
    throw new Error("Quick Resto вернул некорректные строки допродаж");
  return report;
}
const precise = (n: number) => Math.round((n + Number.EPSILON) * 1e8) / 1e8;
export function additionalQuantities(
  kind: AdditionalKind,
  report: AdditionalReport,
  rules = defaultAdditionalRules,
): Record<string, number | null> {
  return Object.fromEntries(
    rules[kind].map((g) => {
      const matching = report.ds.filter(
        (r) =>
          (kind !== "masters" || r.object._Level === 0) &&
          g.branches.includes(String(r.object._branch)),
      );
      return [
        g.id,
        matching.length
          ? precise(
              matching.reduce(
                (s, r) => s + finite(r.object.saleAmount, g.label),
                0,
              ),
            )
          : null,
      ];
    }),
  );
}
export function additionalAward(
  kind: AdditionalKind,
  quantities: Record<string, number | null>,
  rules = defaultAdditionalRules,
) {
  const weighted = precise(
    rules[kind].reduce((sum, g) => sum + (quantities[g.id] ?? 0) * g.rate, 0),
  );
  if (kind === "bar") return { bonus: Math.round(weighted), points: null };
  const tier = [...rules.tiers]
    .filter((t) => t.from <= weighted)
    .sort((a, b) => b.from - a.from)[0];
  return {
    bonus: Math.round(Math.floor(weighted) * (tier?.rate ?? 0)),
    points: precise(weighted),
  };
}
/** Same payout formula as the existing payroll reader, shared with the journal. */
export function extraBonuses(
  masters: AdditionalReport,
  bar: AdditionalReport,
  rules = defaultAdditionalRules,
) {
  const m = additionalAward(
    "masters",
    additionalQuantities("masters", masters, rules),
    rules,
  );
  const b = additionalAward(
    "bar",
    additionalQuantities("bar", bar, rules),
    rules,
  );
  return { masters: m.bonus, bar: b.bonus, masterPoints: m.points! };
}
export function parseAdditionalReports(
  kind: AdditionalKind,
  raw: unknown,
  cocktailRaw?: unknown,
  rules = defaultAdditionalRules,
): AdditionalMetrics {
  validateAdditionalRules(rules);
  const report = rows(raw),
    quantities = additionalQuantities(kind, report, rules);
  let revenue: number, primeCost: number;
  if (kind === "bar") {
    const cocktail = rows(cocktailRaw);
    revenue =
      finite(report.utilityData?.aggregates?.totalSum, "Выручка бара") +
      finite(
        cocktail.utilityData?.aggregates?.totalSum,
        "Выручка конструктора",
      );
    primeCost =
      finite(
        report.utilityData?.aggregates?.primeCostSum,
        "Себестоимость бара",
      ) +
      finite(
        cocktail.utilityData?.aggregates?.primeCostSum,
        "Себестоимость конструктора",
      );
  } else {
    const top = report.ds.filter((r) => r.object._Level === 0);
    revenue = top.reduce(
      (sum, r) => sum + finite(r.object.totalSum, "Выручка кальянов"),
      0,
    );
    primeCost = top.reduce(
      (sum, r) => sum + finite(r.object.primeCostSum, "Себестоимость кальянов"),
      0,
    );
  }
  return {
    revenue: Math.round(revenue),
    primeCost: Math.round(primeCost),
    ...additionalAward(kind, quantities, rules),
    quantities,
  };
}
