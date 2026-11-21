import { test } from "node:test";
import assert from "node:assert/strict";

import {
  comparisonWindows,
  formatChange,
  relativeChange,
} from "./dashboard-compare.ts";

const day = (y: number, m: number, d: number) => new Date(y, m - 1, d);

test("идущий месяц сравнивается по прошедшим дням", () => {
  const c = comparisonWindows({ from: "2026-11-01", to: "2026-11-30" }, day(2026, 11, 21))!;
  assert.equal(c.cutoff, "2026-11-21");
  assert.deepEqual(c.previous?.period, { from: "2026-10-01", to: "2026-10-21" });
  assert.equal(c.previous?.label, "1–21 октября");
  assert.deepEqual(c.lastYear.period, { from: "2025-11-01", to: "2025-11-21" });
  assert.equal(c.lastYear.label, "1–21 ноября 2025");
});

test("закончившийся месяц — с целым прошлым месяцем и тем же месяцем год назад", () => {
  const c = comparisonWindows({ from: "2026-10-01", to: "2026-10-31" }, day(2026, 11, 21))!;
  assert.equal(c.cutoff, null);
  assert.deepEqual(c.previous?.period, { from: "2026-09-01", to: "2026-09-30" });
  assert.equal(c.previous?.label, "сентябрю");
  assert.deepEqual(c.lastYear.period, { from: "2025-10-01", to: "2025-10-31" });
  assert.equal(c.lastYear.label, "октябрю 2025");
});

test("январь сравнивается с декабрём прошлого года — год в подписи", () => {
  const c = comparisonWindows({ from: "2026-01-01", to: "2026-01-31" }, day(2026, 11, 21))!;
  assert.equal(c.previous?.label, "декабрю 2025");
});

test("прошедших дней больше, чем в прошлом месяце — окно не вылезает за месяц", () => {
  const c = comparisonWindows({ from: "2026-03-01", to: "2026-03-31" }, day(2026, 3, 30))!;
  assert.deepEqual(c.previous?.period, { from: "2026-02-01", to: "2026-02-28" });
});

test("февраль високосного года год назад — до 28-го", () => {
  const c = comparisonWindows({ from: "2028-02-01", to: "2028-02-29" }, day(2028, 3, 5))!;
  assert.deepEqual(c.lastYear.period, { from: "2027-02-01", to: "2027-02-28" });
  assert.equal(c.lastYear.label, "февралю 2027");
});

test("год: прошлый период и год назад совпадают — показывается один", () => {
  const c = comparisonWindows({ from: "2025-01-01", to: "2025-12-31" }, day(2026, 11, 21))!;
  assert.equal(c.previous, null);
  assert.equal(c.lastYear.label, "2024 году");
});

test("квартал и неделя", () => {
  const q = comparisonWindows({ from: "2026-07-01", to: "2026-09-30" }, day(2026, 11, 21))!;
  assert.equal(q.previous?.label, "2 кварталу");
  assert.equal(q.lastYear.label, "3 кварталу 2025");
  const w = comparisonWindows({ from: "2026-11-09", to: "2026-11-15" }, day(2026, 11, 21))!;
  assert.equal(w.previous?.label, "2–8 ноября");
  assert.equal(w.lastYear.label, "9–15 ноября 2025");
});

test("будущий период сравнивать не с чем", () => {
  assert.equal(comparisonWindows({ from: "2026-12-01", to: "2026-12-31" }, day(2026, 11, 21)), null);
});

test("изменение и его подпись", () => {
  assert.equal(relativeChange(112, 100), 0.12);
  assert.equal(relativeChange(10, 0), null);
  assert.equal(formatChange(0.12), "+12%");
  assert.equal(formatChange(-0.084), "−8%");
  assert.equal(formatChange(0), "0%");
  assert.equal(formatChange(0.004), "+<1%");
  assert.equal(formatChange(12.5), "+1 250%");
});
