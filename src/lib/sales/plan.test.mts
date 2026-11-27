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
  // Сегодняшняя смена уже в факте; впереди 26 дней — 26 смен по 100.
  assert.equal(p.forecast?.remaining, 26);
  assert.equal(p.forecast?.value, 330 + 26 * 100);
});

test("последний день месяца: прогноз не меньше факта", () => {
  // Смены каждый третий день по 100 000, сегодня (30-е) — смена на 250 000.
  const days = [1, 4, 7, 10, 13, 16, 19, 22, 25, 28].map((d) =>
    day(`2026-11-${String(d).padStart(2, "0")}`, 100_000),
  );
  days.push(day("2026-11-30", 250_000, "preliminary"));
  const p = planProgress({ plan: 2_000_000, month: "2026-11", today: "2026-11-30", days });
  assert.equal(p.fact, 1_250_000);
  assert.equal(p.forecast?.remaining, 0);
  assert.equal(p.forecast?.value, 1_250_000);
});

test("сегодняшняя смена выше средней — прогноз от факта, а не от темпа", () => {
  const days = [1, 2, 3, 4].map((d) => day(`2026-11-0${d}`, 100));
  days.push(day("2026-11-05", 900, "preliminary"));
  const p = planProgress({ plan: 5000, month: "2026-11", today: "2026-11-05", days });
  assert.equal(p.fact, 1300);
  // Впереди 25 дней, работали каждый день — 25 смен по 100.
  assert.equal(p.forecast?.value, 1300 + 25 * 100);
  assert.ok(p.forecast!.value >= p.fact!);
});

test("незакрытая вчерашняя смена не занижает число смен впереди", () => {
  const days = Array.from({ length: 9 }, (_, i) => day(`2026-11-0${i + 1}`, 100));
  days.push(day("2026-11-10", 100, "preliminary"));
  const p = planProgress({ plan: 3000, month: "2026-11", today: "2026-11-11", days });
  assert.equal(p.forecast?.shifts, 9);
  // Работали все 10 прошедших дней: ждём 20 смен (сегодня и ещё 19 дней).
  assert.equal(p.forecast?.remaining, 20);
  assert.equal(p.forecast?.value, 1000 + 20 * 100);
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
