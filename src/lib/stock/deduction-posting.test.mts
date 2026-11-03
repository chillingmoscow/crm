import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildDeductionLines,
  deductionRequestKey,
  monthLabel,
  postMonthlyDeduction,
  type PostDeps,
} from "./deduction-posting.ts";
import { buildShiftWeights, type MonthlySnapshot } from "./monthly-snapshot.ts";
import { deductionRulesSchema } from "./deduction-rules.ts";

const ROLE = "11111111-1111-4111-8111-111111111111";
const E1 = "aaaaaaaa-0000-4000-8000-000000000001";
const E2 = "aaaaaaaa-0000-4000-8000-000000000002";
const DEPT = "dddddddd-1111-4111-8111-111111111111";

const cfg = (over: Record<string, unknown> = {}) =>
  deductionRulesSchema.parse({
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

const snap = (over: Partial<MonthlySnapshot> = {}): MonthlySnapshot => ({
  sources: [{ pool: "shared", key: null, amount: -1000, sourceRef: "inventory:a" }],
  config: cfg(),
  weights: [
    { employeeId: E1, roleId: ROLE, departmentId: DEPT, shifts: 1 },
    { employeeId: E2, roleId: ROLE, departmentId: DEPT, shifts: 1 },
  ],
  unresolved: [],
  ruleVersionId: "bbbbbbbb-0000-4000-8000-000000000001",
  capturedAt: "2026-11-03T10:00:00.000Z",
  storeBindings: [],
  venueId: "dddddddd-0000-4000-8000-000000000001",
  month: "2026-10-01",
  timezone: "Europe/Moscow",
  payrollDayStartHour: 0,
  dataProblems: { undatedActs: [], actsWithoutVenue: [] },
  ...over,
});

function deps(s: MonthlySnapshot) {
  const calls = { post: [] as unknown[], reverse: [] as Array<{ venueId: string; month: string; reason: string }> };
  const d: PostDeps = {
    buildSnapshot: async () => s,
    loadHistory: async () => [],
    post: async (a) => {
      calls.post.push(a);
      return { posted: true, unchanged: false, replayed: false, snapshotId: a.snapshot.id, reversed: 0, targetMonth: a.month, displaced: false, lines: [], inactive: [] };
    },
    reverse: async (a) => {
      calls.reverse.push(a);
      return { reversed: 2 };
    },
    notifyAnomaly: async () => {},
    newId: () => "cccccccc-0000-4000-8000-000000000001",
  };
  return { d, calls };
}

test("incomplete не пишет ничего и возвращает, чего не хватает, вместе с проблемами данных", async () => {
  const { d, calls } = deps(
    snap({
      unresolved: ["inventory:orphan-store", "writeoff:1:77"],
      dataProblems: { undatedActs: ["inventory:undated"], actsWithoutVenue: ["inventory:no-venue"] },
    }),
  );
  const out = await postMonthlyDeduction(d);
  assert.equal(out.state, "incomplete");
  assert.equal(calls.post.length, 0, "ни одного вызова записи");
  if (out.state === "incomplete") {
    assert.deepEqual(out.unresolved, ["inventory:orphan-store", "writeoff:1:77"]);
    assert.deepEqual(out.dataProblems.undatedActs, ["inventory:undated"]);
    assert.deepEqual(out.dataProblems.actsWithoutVenue, ["inventory:no-venue"]);
  }
});

test("пул без распределения (нет смен) - incomplete, а не частичная строка", async () => {
  const { d, calls } = deps(snap({ weights: [] }));
  const out = await postMonthlyDeduction(d);
  assert.equal(out.state, "incomplete");
  assert.equal(calls.post.length, 0);
});

test("правила выключены - ничего не ставится, а прежние строки месяца сторнируются", async () => {
  const { d, calls } = deps(snap({ config: cfg({ enabled: false }) }));
  const out = await postMonthlyDeduction(d);
  assert.equal(out.state, "disabled");
  assert.equal(calls.post.length, 0, "новые строки не ставятся");
  assert.equal(calls.reverse.length, 1, "прежние строки сторнируются ровно один раз");
  assert.equal(calls.reverse[0].month, "2026-10-01");
  assert.match(calls.reverse[0].reason, /Пересчёт удержания по недостаче за 10\.2026/);
  assert.match(calls.reverse[0].reason, /выключены/);
  if (out.state === "disabled") assert.equal(out.reversed, 2);
  assert.match(describePostOutcome(out), /сторнировано: 2/);
});

test("правила выключены, строк не было - сторно ничего не меняет и не пугает текстом", async () => {
  const { d } = deps(snap({ config: cfg({ enabled: false }) }));
  d.reverse = async () => ({ reversed: 0 });
  const out = await postMonthlyDeduction(d);
  assert.equal(out.state, "disabled");
  assert.doesNotMatch(describePostOutcome(out), /сторнировано/);
});

test("правила выключены, а строка в зафиксированном периоде - ошибка сторно видна, не глотается", async () => {
  const { d } = deps(snap({ config: cfg({ enabled: false }) }));
  d.reverse = async () => {
    throw new Error("Период зафиксирован");
  };
  await assert.rejects(postMonthlyDeduction(d), /Период зафиксирован/);
});

test("ready: строки положительные, по одной на сотрудника, сумма сходится с итогом", async () => {
  const { d, calls } = deps(snap());
  const out = await postMonthlyDeduction(d);
  assert.equal(out.state, "ready");
  const sent = calls.post[0] as { lines: Array<{ employee_id: string; amount: number }>; snapshot: { employees_total: number; state: string } };
  assert.deepEqual(sent.lines.map((l) => [l.employee_id, l.amount]), [[E1, 500], [E2, 500]]);
  assert.equal(sent.snapshot.state, "ready");
  assert.equal(sent.snapshot.employees_total, 1000);
  assert.ok(sent.lines.every((l) => l.amount > 0), "знак ставит RPC, отсюда суммы положительные");
});

test("сотрудник в двух пулах получает одну строку с суммой в копейках", () => {
  const lines = buildDeductionLines([
    { pool: "shared", key: null, net: -10.1, chargeable: 10.1, company: 0, employees: 10.1, allocations: [{ employeeId: E1, amount: 0.1 }, { employeeId: E2, amount: 10 }] },
    { pool: "personal", key: E1, net: -0.2, chargeable: 0.2, company: 0, employees: 0.2, allocations: [{ employeeId: E1, amount: 0.2 }] },
  ]);
  assert.deepEqual(lines.map((l) => [l.employeeId, l.amount]), [[E1, 0.3], [E2, 10]]);
  assert.equal(lines[0].pools.length, 2);
});

test("нулевое удержание не даёт строки", () => {
  assert.deepEqual(
    buildDeductionLines([
      { pool: "shared", key: null, net: 0, chargeable: 0, company: 0, employees: 0, allocations: [{ employeeId: E1, amount: 0 }] },
    ]),
    [],
  );
});

test("ключ повтора детерминирован, похож на uuid и различает сотрудника и снимок", () => {
  const k = deductionRequestKey("s1", E1);
  assert.equal(k, deductionRequestKey("s1", E1));
  assert.match(k, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-8[0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.notEqual(k, deductionRequestKey("s1", E2));
  assert.notEqual(k, deductionRequestKey("s2", E1));
});

test("название месяца", () => {
  assert.equal(monthLabel("2026-10-01"), "октябрь 2026");
  assert.equal(monthLabel("2026-03-01"), "март 2026");
});

// Решение 6: собственные строки удержания не блокируют следующий пересчёт.
test("начисление-заглушка под строкой удержания не делает месяц неполным", () => {
  const r = buildShiftWeights({
    accruals: [
      { employee_id: E1, business_date: "2026-10-05", attendance_ids: [10], snapshot_kind: null },
      // Ровно то, что пишет триггер журнала 248 под строкой удержания: {"kind":"adjustment"}.
      { employee_id: E1, business_date: "2026-10-31", attendance_ids: null, snapshot_kind: "adjustment" },
    ],
    attendance: [{ external_id: 10, employee_id: E1, business_date: "2026-10-05", shift_id: "s1", role_name: "Бармен" }],
    shifts: [{ id: "s1", role_id: ROLE, department_id: DEPT }],
    roles: [{ id: ROLE, name: "Бармен", department_id: DEPT, archived_at: null }],
  });
  assert.deepEqual(r.unresolved, []);
  assert.equal(r.weights.length, 1);
  assert.equal(r.weights[0].shifts, 1, "заглушка не считается сменой");
});

import { describePostOutcome, describeUnresolved } from "./deduction-posting.ts";

test("описание неполного месяца называет причину словами", () => {
  assert.equal(
    describeUnresolved(["inventory:a", "inventory:b", "shift:e:2026-10-01", "timezone:x"]),
    "актов инвентаризации: 2; дней смен без должности или отметок: 1; расхождений часовых поясов: 1",
  );
  const text = describePostOutcome({
    state: "incomplete",
    posted: false,
    month: "2026-10-01",
    unresolved: ["writeoff:v:1"],
    dataProblems: { undatedActs: ["inventory:u"], actsWithoutVenue: [] },
  });
  assert.match(text, /не поставлено/);
  assert.match(text, /актов списаний без плательщика: 1/);
  assert.match(text, /Проблем данных вне месяца: 1/);
});

test("описание постановки: перенос периода и уволенный сотрудник видны", async () => {
  const { d } = deps(snap());
  d.post = async (a) => ({
    posted: true, unchanged: false, replayed: false, snapshotId: a.snapshot.id, reversed: 2,
    targetMonth: "2026-11-01", displaced: true,
    lines: [{ adjustment_id: "x", employee_id: E1, amount: -500, business_date: "2026-11-03" }],
    inactive: [{ employee_id: E1, name: "Иван", amount: -500 }],
  });
  const text = describePostOutcome(await postMonthlyDeduction(d));
  assert.match(text, /поставлено в ведомость/);
  assert.match(text, /сторнировано: 2/);
  assert.match(text, /перенесены в ноябрь 2026/);
  assert.match(text, /уволенному сотруднику: Иван/);
});

import { joinUniqueNotices } from "./deduction-posting.ts";

test("одинаковые пояснения по нескольким месяцам показываются один раз", () => {
  const same = "Удержание по недостаче не пересчитано: нет права. Месяц пересчитает пользователь с правом.";
  assert.equal(joinUniqueNotices([same, same]), same);
  assert.equal(joinUniqueNotices([same, "Удержание за октябрь 2026 поставлено.", same]), `${same} Удержание за октябрь 2026 поставлено.`);
});

test("пустые пояснения отбрасываются, без пояснений - null", () => {
  assert.equal(joinUniqueNotices([null, undefined, "", "  "]), null);
  assert.equal(joinUniqueNotices([]), null);
});
