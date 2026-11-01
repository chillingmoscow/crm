import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import ts from "typescript";
const dir = await mkdtemp(join(tmpdir(), "sales-additional-"));
try {
  const source = await readFile("src/lib/sales/additional.ts", "utf8");
  await writeFile(
    join(dir, "additional.mjs"),
    ts.transpileModule(source, {
      compilerOptions: {
        module: ts.ModuleKind.ES2022,
        target: ts.ScriptTarget.ES2022,
      },
    }).outputText,
  );
  const {
    parseAdditionalReports: parse,
    extraBonuses,
    additionalAward: award,
    defaultAdditionalRules: rules,
    validateAdditionalRules: validate,
  } = await import(pathToFileURL(join(dir, "additional.mjs")).href);
  assert.deepEqual(
    award("masters", { premium: 5.999, degust: null, exclusive: null }),
    { bonus: 0, points: 2.9995 },
    "rounding must not cross a payout threshold",
  );
  const item = (name, qty, level = 0, total = 0, cost = 0) => ({
    type: "branchItem",
    object: {
      _branch: name,
      saleAmount: qty,
      _Level: level,
      totalSum: total,
      primeCostSum: cost,
    },
  });
  const masters = {
    ds: [
      item("Премиальный табак", 6, 0, 10000, 600),
      item("Кальян / Премиум", 6, 1, 10000, 600),
      item("Дегустация", 5, 0, 15000, 1000),
      item("Сет / Классика", 5, 1, 15000, 1000),
      item("Чаша / Премиум", 9, 0, 8000, 2000),
    ],
  };
  const bar = {
    ds: [
      item("Премиальный чай", 2),
      item("Добавки", 7),
      item("Ягоды и фрукты", 4),
      item("Фирменные коктейли", 2),
      item("Сет настоек", 7, 1),
      item("Лимонад (графин)", 2),
      item("Авторский чай", 3),
      item("Коктейль-конструктор", 18, 1),
    ],
    utilityData: {
      aggregates: { totalSum: 24025.3, primeCostSum: 1302.79187 },
    },
  };
  const cocktail = {
    ds: [item("Receipt-group", 99, 0, 3900, 523.67521)],
    utilityData: { aggregates: { totalSum: 3900, primeCostSum: 523.67521 } },
  };
  const hookah = parse("masters", masters);
  assert.deepEqual(
    [hookah.revenue, hookah.primeCost, hookah.points, hookah.bonus],
    [33000, 3600, 9.25, 2700],
    "Top-level totals only; premium bowls enter revenue/cost, not incentivized counts",
  );
  const bartender = parse("bar", bar, cocktail);
  assert.deepEqual(
    [
      bartender.revenue,
      bartender.primeCost,
      bartender.quantities.additions,
      bartender.quantities.constructor,
      bartender.bonus,
    ],
    [27925, 1826, 11, 18, 6640],
    "Footer sums, exact branch names including sub-groups, no duplicate constructor quantity",
  );
  assert.deepEqual(
    extraBonuses(masters, bar),
    { masters: 2700, bar: 6640, masterPoints: 9.25 },
    "Shared payroll helper retains the published formula",
  );
  for (const [points, expected] of [
    [2.5, 0],
    [3, 450],
    [5.75, 750],
    [6, 1350],
    [8.75, 1800],
    [9, 2700],
  ])
    assert.equal(
      award("masters", { exclusive: points / 2 }, rules).bonus,
      expected,
    );
  assert.equal(parse("masters", { ds: [] }).bonus, 0);
  assert.equal(
    bartender.quantities.wine_bottle,
    null,
    "Absent branch remains absent",
  );
  assert.equal(
    parse("bar", { ...bar, ds: [item("Премиальный чай", 0)] }, cocktail)
      .quantities.tea,
    0,
    "Reported zero is known zero",
  );
  assert.throws(() => parse("bar", bar, { ds: [] }));
  assert.throws(() =>
    parse("masters", { ds: [{ object: { _Level: 0, totalSum: 1 } }] }),
  );
  assert.throws(() => parse("masters", { ds: "error" }));
  assert.throws(
    () =>
      validate({
        ...rules,
        bar: [...rules.bar, { ...rules.bar[0], id: "other" }],
      }),
    "Repeated branches cannot double-award",
  );
  assert.throws(() =>
    validate({
      ...rules,
      tiers: [
        { from: 3, rate: 150 },
        { from: 3, rate: 300 },
      ],
    }),
  );
  assert.equal(
    "income" in hookah,
    false,
    "Owner excluded additional-income calculations",
  );
  if (process.argv[2]) {
    const live = JSON.parse(await readFile(process.argv[2], "utf8"));
    const a = parse("masters", live.masters),
      b = parse("bar", live.bar, live.cocktails);
    assert.deepEqual(
      [
        a.revenue,
        a.primeCost,
        a.points,
        a.bonus,
        b.revenue,
        b.primeCost,
        b.bonus,
      ],
      [33952, 4023, 9.25, 2700, 27925, 1826, 6640],
    );
    console.log(
      "PASS: real published executions 23771/23773 match Fees and shared payroll award",
    );
  }
  for(const name of ['types','day-context']) {
    await writeFile(join(dir,`${name}.mjs`),ts.transpileModule((await readFile(`src/lib/sales/${name}.ts`,'utf8')).replaceAll('"./types"','"./types.mjs"'),{compilerOptions:{module:ts.ModuleKind.ES2022,target:ts.ScriptTarget.ES2022}}).outputText);
  }
  await writeFile(
    join(dir, "additional-view.mjs"),
    ts.transpileModule(
      (await readFile("src/lib/sales/additional-view.ts", "utf8")).replace(
        '"./additional"',
        '"./additional.mjs"',
      ).replaceAll('"./day-context"','"./day-context.mjs"'),
      {
        compilerOptions: {
          module: ts.ModuleKind.ES2022,
          target: ts.ScriptTarget.ES2022,
        },
      },
    ).outputText,
  );
  const {dayContext,nativeDayMembers,departmentMember,memberTotal}=await import(pathToFileURL(join(dir,'day-context.mjs')).href);
  const day={id:'native',venue_id:'venue',business_date:'2026-10-30',status:'complete',calculated:{turnover:100},overrides:{turnover:125},updated_at:'2026-10-31T10:00:00Z'};
  const archive={id:'archive',venue_id:'venue',business_date:day.business_date,legacy_ref:'shift-source',captured_at:'2026-10-31T09:00:00Z',metrics:{turnover:90}};
  assert.equal(dayContext('venue',day.business_date,'native',[day],[archive]).turnover,125,'Native day uses approved override');
  assert.equal(dayContext('venue',day.business_date,'archive',[day],[archive],'shift-source').turnover,90,'Archive never uses current native turnover');
  assert.equal(dayContext('venue',day.business_date,'archive',[day],[archive],'different-shift').turnover,null,'No guess by date when source row mismatches');
  assert.equal(dayContext('other',day.business_date,'native',[day],[archive]).turnover,null,'Reference cannot cross venue');
  const team=nativeDayMembers([{id:'accrual',employee_id:'employee',salary:'1000',tips:null,issues:[],components:[{kind:'extra',amount:200}],calculation_snapshot:{role:'Бармен',position_name:'Бармен',model:{extras_enabled:true}}},{id:'monthly',employee_id:'employee',components:[],calculation_snapshot:{kind:'monthly'}}],[{id:'employee',name:'QA',role_name:'Менеджер'}]);
  assert.equal(team.length,1,'Monthly salary does not enter shift payroll');assert.equal(departmentMember(team[0],'bar'),true,'Use substitution position, not current primary position');assert.equal(team[0].extras,200);assert.equal(memberTotal(team,'tips'),null,'Missing tips must not become zero');
  const {
    additionalCoverage,
    additionalRows,
    additionalTotal,
    additionalNeedsRefresh,
  } = await import(pathToFileURL(join(dir, "additional-view.mjs")).href);
  assert.equal(
    additionalNeedsRefresh(
      [
        { business_date: "2026-10-30", state: "ready" },
        { business_date: "2026-10-29", state: "error" },
      ],
      "2026-10",
    ),
    true,
    "UI must keep following automatic retry after pending jobs become errors",
  );
  assert.equal(
    additionalNeedsRefresh(
      [
        { business_date: "2026-10-30", state: "ready" },
        { business_date: "2026-09-30", state: "error" },
      ],
      "2026-10",
    ),
    false,
  );
  assert.equal(additionalCoverage("2026-10-01", "2026-10-30"), 30);
  assert.equal(additionalCoverage("2026-11-01", "2026-10-30"), 0);
  assert.equal(additionalCoverage("2024-02-01", "2024-03-01"), 29);
  assert.equal(
    additionalCoverage("2026-10-01", "2026-10-30", "2026-10-16"),
    15,
  );
  const archiveRow = {
    id: "a",
    kind: "masters",
    business_date: "2026-10-30",
    captured_at: "2026-10-31T00:00:00Z",
    metrics: {
      revenue: 1,
      primeCost: 0,
      bonus: 0,
      points: 0,
      quantities: { premium: null, degust: 0, exclusive: null },
    },
  };
  const archiveRows = additionalRows(
    [],
    [
      archiveRow,
      {
        ...archiveRow,
        id: "b",
        captured_at: "2026-11-01T00:00:00Z",
        metrics: { ...archiveRow.metrics, bonus: 150 },
      },
    ],
    "archive",
    "masters",
  );
  assert.equal(archiveRows.length, 1);
  assert.equal(archiveRows[0].metrics.bonus, 150);
  assert.deepEqual(additionalTotal(archiveRows, "premium"), {
    value: null,
    known: 0,
    total: 1,
  });
  assert.deepEqual(additionalTotal(archiveRows, "degust"), {
    value: 0,
    known: 1,
    total: 1,
  });
  const originalRequest = { rules, rule_id: "old" };
  const nextRules = structuredClone(rules);
  nextRules.masters[0].rate = 999;
  const retained = additionalRows(
    [
      {
        id: "r",
        kind: "masters",
        business_date: "2026-10-30",
        metrics: archiveRow.metrics,
        request: { rules: nextRules, rule_id: "new" },
        metrics_request: originalRequest,
        state: "error",
      },
    ],
    [],
    "native",
    "masters",
  );
  assert.equal(retained[0].rules.masters[0].rate, 0.5);
  const reserved = structuredClone(rules);
  reserved.bar[0].id = "bonus";
  assert.throws(() => validate(reserved));
  console.log(
    "PASS: report hierarchy, footer totals, null/zero, tier boundaries, unique categories, unchanged salary formula and excluded income",
  );
} finally {
  await rm(dir, { recursive: true, force: true });
}
