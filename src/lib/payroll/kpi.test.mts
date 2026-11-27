import test from "node:test";
import assert from "node:assert/strict";
import { KPI_WAITING_MONTH, kpiNeedsRecount, kpiPeople, kpiReason, kpiResult, kpiSummary, parseKpiItems, SENIOR_BAR, type KpiPlanFact } from "./kpi.ts";
import type { PayAssignment, PayEmployee, PayModel } from "./types.ts";

const all = { inventory: true, purchasing: true, team_event: true, seasonal: 2 };

test("KPI: всё выполнено, план выполнен, две сезонные — 37 000", () => {
  assert.equal(kpiResult(SENIOR_BAR, all, { target: 10, actual: 10 }).total, 37000);
});

test("KPI: доля 9,99% при плане 10% — не засчитан, остальное 27 000", () => {
  const r = kpiResult(SENIOR_BAR, all, { target: 10, actual: 9.99 });
  assert.equal(r.total, 27000);
  const plan = r.lines.find((l) => l.id === "alcohol_plan")!;
  assert.equal(plan.counted, false);
  assert.equal(plan.note, "9,99% при плане 10%");
});

test("KPI: без одного из трёх нет бонуса за все", () => {
  assert.equal(kpiResult(SENIOR_BAR, { inventory: false, purchasing: true, team_event: true }, { target: null, actual: null }).total, 13000);
});

test("KPI: план не задан и отчёт не готов — разные пометки", () => {
  const line = (p: KpiPlanFact) => kpiResult(SENIOR_BAR, {}, p).lines.find((l) => l.id === "alcohol_plan")!;
  assert.equal(line({ target: null, actual: 5 }).note, "План не был задан");
  assert.equal(line({ target: 5, actual: null }).note, "Ждём отчёт Quick Resto");
  assert.equal(line({ target: 5, actual: null }).counted, false);
});

test("KPI: основание премии", () => {
  const r = kpiResult(SENIOR_BAR, { inventory: true, seasonal: 2 }, { target: null, actual: null });
  assert.equal(kpiReason("2026-11-01", r.lines), "KPI за ноябрь 2026: Инвентаризация до 20-го, Сезонные позиции ×2");
  assert.equal(kpiReason("2026-11-01", kpiResult(SENIOR_BAR, {}, { target: null, actual: null }).lines), "KPI за ноябрь 2026: без выполненных пунктов");
});

test("KPI: сводка условий", () => {
  assert.deepEqual(kpiSummary(SENIOR_BAR), { count: 6, max: 35000, each: [{ label: "Сезонные позиции", price: 1000 }] });
});

test("KPI: условия Павла проходят проверку", () => {
  assert.deepEqual(parseKpiItems(SENIOR_BAR), SENIOR_BAR);
});

test("KPI: проверка условий отклоняет ошибки", () => {
  const done = (id: string) => ({ id, type: "done", label: id, amount: 100 });
  assert.throws(() => parseKpiItems([done("a"), done("a")]), /повторяется/);
  assert.throws(() => parseKpiItems([done("a"), { id: "b", type: "all", label: "Все", amount: 5, requires: ["a"] }]), /двух и более/);
  assert.throws(() => parseKpiItems([
    { id: "p", type: "plan", label: "План", amount: 1, metric: "alcohol" },
    { id: "q", type: "plan", label: "План 2", amount: 1, metric: "alcohol" },
  ]), /один план/);
  assert.throws(() => parseKpiItems([{ ...done("a"), amount: 0 }]), /больше нуля/);
  assert.throws(() => parseKpiItems([]), /хотя бы один/);
});

test("KPI: сезонных больше 50 — ошибка", () => {
  assert.throws(() => kpiResult(SENIOR_BAR, { seasonal: 51 }, { target: null, actual: null }), /от 0 до 50/);
});

const model = (id: string, role_id: string) => ({ id, role_id, role_name: "Бармен" }) as PayModel;
const models = [model("m-senior", "r-senior"), model("m-bar", "r-bar")];
const employee = (id: string, model_id: string, extra: Partial<PayEmployee> = {}) =>
  ({ id, model_id, role_name: "Бармен", active: true, casual: false, hired_on: null, ...extra }) as PayEmployee;
const terms = [{ id: "t1", role_id: "r-senior", valid_from: "2026-11-01" }];

test("KPI: кто подводит итоги — старший бармен, обычный нет", () => {
  const people = kpiPeople([employee("s", "m-senior"), employee("b", "m-bar")], [], models, terms, "2026-11-01", new Set());
  assert.deepEqual(people, [{ employeeId: "s", termsId: "t1", roleId: "r-senior", since: null }]);
});

test("KPI: должность с середины месяца — пометка since", () => {
  const assignments: PayAssignment[] = [
    { id: "a1", employee_id: "s", model_id: "m-bar", valid_from: "2026-09-01" },
    { id: "a2", employee_id: "s", model_id: "m-senior", valid_from: "2026-11-12" },
  ];
  assert.equal(kpiPeople([employee("s", "m-senior")], assignments, models, terms, "2026-11-01", new Set())[0].since, "2026-11-12");
});

test("KPI: условия с декабря не действуют в ноябре, октябрь не предлагается", () => {
  const later = [{ id: "t2", role_id: "r-senior", valid_from: "2026-12-01" }];
  assert.deepEqual(kpiPeople([employee("s", "m-senior")], [], models, later, "2026-11-01", new Set()), []);
  assert.deepEqual(kpiPeople([employee("s", "m-senior")], [], models, [{ ...terms[0], valid_from: "2026-09-01" }], "2026-10-01", new Set()), []);
});

test("KPI: уволенный — только с начислениями за месяц; разовые — никогда", () => {
  const gone = employee("s", "m-senior", { active: false });
  assert.deepEqual(kpiPeople([gone], [], models, terms, "2026-11-01", new Set()), []);
  assert.equal(kpiPeople([gone], [], models, terms, "2026-11-01", new Set(["s"])).length, 1);
  assert.deepEqual(kpiPeople([employee("c", "m-senior", { casual: true })], [], models, terms, "2026-11-01", new Set(["c"])), []);
});

test("KPI: итог, сохранённый до отчёта продаж, надо досчитать", () => {
  assert.equal(kpiNeedsRecount(kpiResult(SENIOR_BAR, all, { target: 10, actual: null }).lines), true);
  assert.equal(kpiNeedsRecount(kpiResult(SENIOR_BAR, all, { target: 10, actual: 9.5 }).lines), false);
  assert.equal(kpiNeedsRecount(kpiResult(SENIOR_BAR, all, { target: null, actual: null }).lines), false);
  assert.equal(kpiNeedsRecount([]), false);
});

const share = (target: number | null, actual: number | null, pending: KpiPlanFact["pending"] = null): KpiPlanFact => ({ target, actual, pending });

test("kpiResult: месяц не закончился — план «Посчитаем после конца месяца»", () => {
  const line = kpiResult(SENIOR_BAR, {}, share(10, null, "month")).lines.find((l) => l.id === "alcohol_plan")!;
  assert.equal(line.note, KPI_WAITING_MONTH);
  assert.equal(line.counted, false);
  assert.equal(kpiNeedsRecount(kpiResult(SENIOR_BAR, {}, share(10, null, "month")).lines), true);
});

test("kpiResult: доля 10,4 при плане 10 — засчитан, 9,99 — нет", () => {
  const plan = (actual: number) => kpiResult(SENIOR_BAR, {}, share(10, actual)).lines.find((l) => l.id === "alcohol_plan")!;
  assert.equal(plan(10.4).counted, true);
  assert.equal(plan(10.4).note, "10,4% при плане 10%");
  assert.equal(plan(9.99).counted, false);
});

test("parseKpiItems: metric alcohol читается как alcohol_share", () => {
  const [item] = parseKpiItems([{ id: "p", type: "plan", label: "План", amount: 1, metric: "alcohol" }]);
  assert.equal(item.type === "plan" && item.metric, "alcohol_share");
});

test("kpiResult: месяц идёт и плана нет — ждём конца месяца, а не «план не задан»", () => {
  const line = kpiResult(SENIOR_BAR, {}, { target: null, actual: null, pending: "month" }).lines.find((l) => l.id === "alcohol_plan")!;
  assert.equal(line.note, KPI_WAITING_MONTH);
});
