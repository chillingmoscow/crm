import { test } from "node:test";
import assert from "node:assert/strict";
import { allocateMonthlyShortage } from "./monthly-shortage.ts";
import type { DeductionRules } from "./deduction-rules.ts";
import type { ShiftWeight } from "./shared-shortage.ts";

const rules = (over: Partial<DeductionRules> = {}): DeductionRules => ({
  enabled: true,
  companyAllowance: 0,
  multiplier: 1,
  ingredientTolerance: 0,
  distribution: "shifts",
  split: "once",
  inventoryExclusions: [],
  roleSpecificCategories: [],
  writeoffReasons: [],
  excludedRoleIds: [],
  groups: [],
  ...over,
});
const ROLE = "11111111-1111-4111-8111-111111111111";
const w = (
  employeeId: string,
  departmentId: string,
  shifts: number,
): ShiftWeight => ({ employeeId, roleId: ROLE, departmentId, shifts });
const shared = (amount: number, ref = "s") => ({
  pool: "shared" as const,
  key: null,
  amount,
  sourceRef: ref,
});
const dept = (key: string, amount: number, ref = "d") => ({
  pool: "department" as const,
  key,
  amount,
  sourceRef: ref,
});
const sum = (xs: { amount: number }[]) =>
  Math.round(xs.reduce((s, x) => s + x.amount * 100, 0)) / 100;

test("излишек пула сгорает и не уменьшает другие пулы", () => {
  const r = allocateMonthlyShortage({
    sources: [dept("hookah", 2000), shared(-5000)],
    config: rules(),
    weights: [w("e1", "bar", 1)],
    unresolved: [],
  });
  const h = r.pools.find((p) => p.pool === "department")!;
  const s = r.pools.find((p) => p.pool === "shared")!;
  assert.equal(h.net, 2000);
  assert.equal(h.chargeable, 0);
  assert.equal(s.chargeable, 5000);
  assert.equal(r.employees, 5000);
  assert.equal(r.state, "ready");
});

test("лимит применяется только к общему пулу", () => {
  const r = allocateMonthlyShortage({
    sources: [shared(-12000), dept("hookah", -3000)],
    config: rules({ companyAllowance: 10000 }),
    weights: [w("e1", "bar", 1), w("e2", "hookah", 1)],
    unresolved: [],
  });
  const s = r.pools.find((p) => p.pool === "shared")!;
  const h = r.pools.find((p) => p.pool === "department")!;
  assert.equal(s.company, 10000);
  assert.equal(s.employees, 2000);
  assert.equal(h.company, 0);
  assert.equal(h.employees, 3000);
  assert.equal(r.company, 10000);
  assert.equal(r.employees, 5000);
  assert.equal(r.total, 15000);
});

test("сальдо пула считается по сумме источников", () => {
  const r = allocateMonthlyShortage({
    sources: [shared(-5000, "a"), shared(2000, "b")],
    config: rules(),
    weights: [w("e1", "bar", 1)],
    unresolved: [],
  });
  assert.equal(r.pools.length, 1);
  assert.equal(r.pools[0].net, -3000);
  assert.equal(r.pools[0].chargeable, 3000);
  assert.equal(r.employees, 3000);
});

test("сотрудник без смен в подразделении не получает ничего", () => {
  const r = allocateMonthlyShortage({
    sources: [dept("hookah", -900)],
    config: rules(),
    weights: [
      w("e1", "hookah", 3),
      w("e2", "hookah", 0),
      w("e3", "bar", 5), // другое подразделение — не участвует
    ],
    unresolved: [],
  });
  assert.deepEqual(r.pools[0].allocations, [{ employeeId: "e1", amount: 900 }]);
  assert.equal(r.state, "ready");
});

test("подмена подразделения даёт два веса одного сотрудника", () => {
  const r = allocateMonthlyShortage({
    sources: [shared(-1000)],
    config: rules(),
    weights: [w("e1", "bar", 4), w("e1", "hookah", 6), w("e2", "bar", 10)],
    unresolved: [],
  });
  assert.deepEqual(r.pools[0].allocations, [
    { employeeId: "e1", amount: 500 },
    { employeeId: "e2", amount: 500 },
  ]);
  assert.equal(sum(r.pools[0].allocations), 1000);
});

test("непривязанный источник делает месяц неполным", () => {
  const r = allocateMonthlyShortage({
    sources: [shared(-1000)],
    config: rules(),
    weights: [w("e1", "bar", 1)],
    unresolved: ["act-42"],
  });
  assert.equal(r.state, "incomplete");
  assert.deepEqual(r.unresolved, ["act-42"]);
  assert.equal(r.employees, 0);
  assert.ok(r.pools.every((p) => p.allocations.length === 0));
});

test("выключенные правила отдают всё заведению", () => {
  const r = allocateMonthlyShortage({
    sources: [shared(-1000), dept("hookah", -300)],
    config: rules({ enabled: false }),
    weights: [w("e1", "bar", 1), w("e2", "hookah", 1)],
    unresolved: [],
  });
  assert.equal(r.state, "disabled");
  assert.equal(r.employees, 0);
  assert.equal(r.company, 1300);
  assert.ok(r.pools.every((p) => p.allocations.length === 0));
});

test("копейки раздаются по стабильному ключу", () => {
  const ws = [w("a", "bar", 1), w("b", "bar", 1), w("c", "bar", 1)];
  const run = (weights: ShiftWeight[]) =>
    allocateMonthlyShortage({
      sources: [shared(-100.01)],
      config: rules(),
      weights,
      unresolved: [],
    });
  const x = run(ws);
  const y = run([ws[2], ws[0], ws[1]]);
  assert.deepEqual(x.pools[0].allocations, y.pools[0].allocations);
  assert.deepEqual(x.pools[0].allocations, [
    { employeeId: "a", amount: 33.34 },
    { employeeId: "b", amount: 33.34 },
    { employeeId: "c", amount: 33.33 },
  ]);
  assert.equal(sum(x.pools[0].allocations), 100.01);
});

test("личное списание ложится на сотрудника целиком, без лимита", () => {
  const r = allocateMonthlyShortage({
    sources: [{ pool: "personal", key: "e9", amount: -700, sourceRef: "w1" }],
    config: rules({ companyAllowance: 10000 }),
    weights: [],
    unresolved: [],
  });
  assert.deepEqual(r.pools[0].allocations, [{ employeeId: "e9", amount: 700 }]);
  assert.equal(r.company, 0);
  assert.equal(r.employees, 700);
});

test("легаси split: pending не считается готовым месяцем", () => {
  const r = allocateMonthlyShortage({
    sources: [shared(-1000)],
    config: rules({ split: "pending" }),
    weights: [w("e1", "bar", 1)],
    unresolved: [],
  });
  assert.equal(r.state, "incomplete");
  assert.equal(r.employees, 0);
  assert.deepEqual(r.pools[0].allocations, []);
});

test("неразданный пул делает неполным весь месяц, даже распределимые пулы", () => {
  const r = allocateMonthlyShortage({
    sources: [dept("hookah", -900), shared(-500)],
    config: rules(),
    weights: [w("e1", "bar", 2), w("e2", "hookah", 0)],
    unresolved: [],
  });
  assert.equal(r.state, "incomplete");
  assert.equal(r.employees, 0);
  assert.equal(r.company, 0);
  assert.equal(r.total, 1400);
  assert.ok(r.pools.every((p) => p.allocations.length === 0));
});

test("выключенные правила важнее непривязанных источников", () => {
  const r = allocateMonthlyShortage({
    sources: [shared(-1000)],
    config: rules({ enabled: false }),
    weights: [w("e1", "bar", 1)],
    unresolved: ["act-1"],
  });
  assert.equal(r.state, "disabled");
  assert.equal(r.company, 1000);
  assert.equal(r.employees, 0);
  assert.deepEqual(r.unresolved, ["act-1"]);
});

test("пустой ключ пула считается отсутствующим", () => {
  const r = allocateMonthlyShortage({
    sources: [dept("", -100, "a")],
    config: rules(),
    weights: [w("e1", "", 1)],
    unresolved: [],
  });
  assert.equal(r.state, "incomplete");
  assert.equal(r.pools[0].key, null);
});

test("unresolved возвращается копией", () => {
  const input = {
    sources: [shared(-1)],
    config: rules(),
    weights: [w("e1", "bar", 1)],
    unresolved: ["x"],
  };
  const r = allocateMonthlyShortage(input);
  r.unresolved.push("y");
  assert.deepEqual(input.unresolved, ["x"]);

  // Возврат disabled и возврат ready тоже отдают копию.
  for (const enabled of [false, true]) {
    const src: string[] = enabled ? [] : ["x"];
    const out = allocateMonthlyShortage({
      ...input,
      config: rules({ enabled }),
      unresolved: src,
    });
    out.unresolved.push("y");
    assert.deepEqual(src, enabled ? [] : ["x"]);
  }
});

test("порядок пулов не зависит от порядка источников", () => {
  const sources = [
    dept("hookah", -300),
    shared(-100),
    dept("bar", -200),
    { pool: "personal" as const, key: "e1", amount: -50, sourceRef: "p" },
  ];
  const weights = [w("e1", "bar", 1), w("e2", "hookah", 1)];
  const run = (s: typeof sources) =>
    allocateMonthlyShortage({ sources: s, config: rules(), weights, unresolved: [] });
  const a = run(sources);
  const b = run([...sources].reverse());
  assert.deepEqual(a, b);
  assert.deepEqual(
    a.pools.map((p) => `${p.pool}:${p.key}`),
    ["department:bar", "department:hookah", "personal:e1", "shared:null"],
  );
});
