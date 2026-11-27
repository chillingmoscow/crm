import test from "node:test";
import assert from "node:assert/strict";
import { alcoholActual, alcoholShareStatus } from "./alcohol-plan.ts";

test("факт: неполный отчёт — нет данных", () =>
  assert.equal(alcoholActual({ month: "2026-11-01", revenue: 300000, through_date: "2026-11-29", state: "ready" }, "2026-11-01"), null));
test("факт: отчёт с ошибкой — нет данных", () =>
  assert.equal(alcoholActual({ month: "2026-11-01", revenue: 300000, through_date: "2026-11-30", state: "error" }, "2026-11-01"), null));
test("факт: полный отчёт", () =>
  assert.equal(alcoholActual({ month: "2026-11-01", revenue: 332199.1, through_date: "2026-11-30", state: "ready" }, "2026-11-01"), 332199.1));
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
