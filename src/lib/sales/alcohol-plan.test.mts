import test from "node:test";
import assert from "node:assert/strict";
import { alcoholActual, alcoholHistory, alcoholShareStatus, suggestAlcoholPlan } from "./alcohol-plan.ts";

const h = new Map([["2026-11-01", 332199.1], ["2025-12-01", 400000], ["2025-11-01", 320000]]);

test("план: сезонность прошлого года", () => {
  const r = suggestAlcoholPlan(h, "2026-12-01", null);
  assert.deepEqual([r.amount, r.basis, r.lastMonth, r.lastYearSame, r.lastYearPrev], [416000, "seasonal", 332199.1, 400000, 320000]);
});
test("план: с повышением цен 5%", () => assert.equal(suggestAlcoholPlan(h, "2026-12-01", 5).amount, 437000));
test("план: без прошлого года — прошлый месяц", () => {
  const r = suggestAlcoholPlan(new Map([["2026-11-01", 332199.1]]), "2026-12-01", 5);
  assert.deepEqual([r.amount, r.basis], [349000, "last_month"]);
});
test("план: ноль год назад — не делим на ноль", () =>
  assert.equal(suggestAlcoholPlan(new Map([["2026-11-01", 332199.1], ["2025-12-01", 400000], ["2025-11-01", 0]]), "2026-12-01", null).basis, "last_month"));
test("план: нет прошлого месяца — нет предложения", () => {
  const r = suggestAlcoholPlan(new Map(), "2026-12-01", null);
  assert.deepEqual([r.amount, r.basis], [null, "none"]);
});
test("план: январь берёт декабрь и прошлый год через границу года", () =>
  assert.equal(suggestAlcoholPlan(new Map([["2026-12-01", 500000], ["2026-01-01", 300000], ["2025-12-01", 400000]]), "2027-01-01", null).amount, 375000));
test("факт: неполный отчёт — нет данных", () =>
  assert.equal(alcoholActual({ month: "2026-11-01", revenue: 300000, through_date: "2026-11-29", state: "ready" }, "2026-11-01"), null));
test("факт: отчёт с ошибкой — нет данных", () =>
  assert.equal(alcoholActual({ month: "2026-11-01", revenue: 300000, through_date: "2026-11-30", state: "error" }, "2026-11-01"), null));
test("факт: полный отчёт", () =>
  assert.equal(alcoholActual({ month: "2026-11-01", revenue: 332199.1, through_date: "2026-11-30", state: "ready" }, "2026-11-01"), 332199.1));
test("история: отчёт важнее архива, архив — запасной, ноль — нет данных", () => {
  const m = alcoholHistory(
    [{ month: "2026-10-01", revenue: 434100.7, through_date: "2026-10-31", state: "ready" }, { month: "2026-09-01", revenue: 0, through_date: "2026-09-30", state: "ready" }],
    [{ month: "2026-10-01", alcoholRevenue: 434101 }, { month: "2026-08-01", alcoholRevenue: 250000 }, { month: "2026-07-01", alcoholRevenue: 0 }],
  );
  assert.deepEqual([...m.entries()].sort(), [["2026-08-01", 250000], ["2026-10-01", 434100.7]]);
});

test("факт: полный отчёт с нулём — ноль, а не «нет данных»", () =>
  assert.equal(alcoholActual({ month: "2026-11-01", revenue: 0, through_date: "2026-11-30", state: "ready" }, "2026-11-01"), 0));

const ready = { state: "ready", through_date: "2026-11-30", revenue: 330000 };
test("alcoholShareStatus: месяц идёт — ждём конца месяца", () =>
  assert.deepEqual(alcoholShareStatus({ month: "2026-11-01", today: "2026-11-27", report: ready, share: 10.2 }), { actual: null, pending: "month" }));
test("alcoholShareStatus: отчёт неполный или без доли — ждём отчёт", () => {
  assert.deepEqual(alcoholShareStatus({ month: "2026-11-01", today: "2026-12-01", report: { ...ready, through_date: "2026-11-29" }, share: 10.2 }), { actual: null, pending: "report" });
  assert.deepEqual(alcoholShareStatus({ month: "2026-11-01", today: "2026-12-01", report: ready, share: null }), { actual: null, pending: "report" });
  assert.deepEqual(alcoholShareStatus({ month: "2026-11-01", today: "2026-12-01", report: null, share: null }), { actual: null, pending: "report" });
});
test("alcoholShareStatus: полный отчёт — доля", () =>
  assert.deepEqual(alcoholShareStatus({ month: "2026-11-01", today: "2026-12-01", report: ready, share: 10.4 }), { actual: 10.4, pending: null }));
