import { test } from "node:test";
import assert from "node:assert/strict";
import { planProgress } from "./plan.ts";

const day = (date: string, turnover: number | null, status: "complete" | "preliminary" = "complete") => ({
  business_date: date,
  status,
  calculated: turnover === null ? {} : { turnover },
  overrides: {},
});

test("прогноз — средний оборот закрытой смены × оставшиеся смены", () => {
  // Ноябрь, 30 дней. Сегодня 11-е: прошло 10 дней, закрыто 10 смен по 100.
  const days = Array.from({ length: 10 }, (_, i) =>
    day(`2026-11-${String(i + 1).padStart(2, "0")}`, 100),
  );
  const p = planProgress({ plan: 3000, month: "2026-11", today: "2026-11-11", days });
  assert.equal(p.fact, 1000);
  assert.equal(p.phase, "current");
  assert.deepEqual(p.forecast, { value: 3000, ratio: 1, pace: 100, shifts: 10, remaining: 20 });
});

test("выходные: оставшихся смен столько же по доле, что и прошедших", () => {
  // Прошло 10 дней, работали 5 (через день) — из 20 оставшихся ждём 10 смен.
  const days = [1, 3, 5, 7, 9].map((d) => day(`2026-11-0${d}`, 200));
  const p = planProgress({ plan: 4000, month: "2026-11", today: "2026-11-11", days });
  assert.equal(p.forecast?.remaining, 10);
  assert.equal(p.forecast?.value, 1000 + 200 * 10);
});

test("идущая смена входит в оборот, но не в темп", () => {
  const days = [
    day("2026-11-01", 100),
    day("2026-11-02", 100),
    day("2026-11-03", 100),
    day("2026-11-04", 30, "preliminary"),
  ];
  const p = planProgress({ plan: 1000, month: "2026-11", today: "2026-11-04", days });
  assert.equal(p.fact, 330);
  assert.equal(p.forecast?.pace, 100);
  assert.equal(p.forecast?.shifts, 3);
  // Сегодня и ещё 26 дней — 27 смен по 100 сверх закрытых 300.
  assert.equal(p.forecast?.value, 300 + 27 * 100);
});

test("меньше трёх закрытых смен — прогноза нет", () => {
  const days = [day("2026-11-01", 100), day("2026-11-02", 100)];
  const p = planProgress({ plan: 1000, month: "2026-11", today: "2026-11-03", days });
  assert.equal(p.forecast, null);
  assert.equal(p.closedShifts, 2);
  assert.equal(p.ratio, 0.2);
});

test("прошлый месяц — итог без прогноза; без оборота — прочерк, не ноль", () => {
  const past = planProgress({
    plan: 1000,
    month: "2026-10",
    today: "2026-11-05",
    days: [day("2026-10-01", 1200), day("2026-10-02", 100)],
  });
  assert.equal(past.phase, "past");
  assert.equal(past.forecast, null);
  assert.equal(past.ratio, 1.3);
  const empty = planProgress({ plan: 1000, month: "2026-12", today: "2026-11-05", days: [] });
  assert.equal(empty.phase, "future");
  assert.equal(empty.fact, null);
  assert.equal(empty.ratio, null);
});

test("смена без оборота не считается ни в факт, ни в темп", () => {
  const days = [
    day("2026-11-01", 100),
    day("2026-11-02", null),
    day("2026-11-03", 100),
    day("2026-11-04", 100),
  ];
  const p = planProgress({ plan: 1000, month: "2026-11", today: "2026-11-05", days });
  assert.equal(p.fact, 300);
  assert.equal(p.forecast?.shifts, 3);
});
