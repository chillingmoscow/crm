import { test } from "node:test";
import assert from "node:assert/strict";

import {
  PERIOD_PRESETS,
  defaultPeriod,
  nextIsoDay,
  parseIsoDay,
  periodContains,
  periodLabel,
  resolvePeriod,
  shiftPeriod,
  wholeMonths,
} from "./dashboard-period.ts";

const today = new Date(2026, 10, 21); // 21 ноября 2026

test("период по умолчанию — текущий месяц", () => {
  assert.deepEqual(defaultPeriod(today), { from: "2026-11-01", to: "2026-11-30" });
});

test("parseIsoDay отбрасывает мусор и несуществующие даты", () => {
  assert.equal(parseIsoDay("foo"), null);
  assert.equal(parseIsoDay("2026-13-40"), null);
  assert.equal(parseIsoDay("2026-02-29"), null);
  assert.equal(parseIsoDay(""), null);
  assert.equal(parseIsoDay(undefined), null);
  assert.ok(parseIsoDay("2028-02-29"));
});

test("resolvePeriod: битая граница — период по умолчанию целиком", () => {
  assert.deepEqual(resolvePeriod("2026-10-01", "foo", today), {
    period: { from: "2026-11-01", to: "2026-11-30" },
    isDefault: true,
  });
  assert.deepEqual(resolvePeriod(undefined, undefined, today).isDefault, true);
});

test("resolvePeriod меняет перепутанные границы местами", () => {
  assert.deepEqual(resolvePeriod("2026-10-31", "2026-10-01", today), {
    period: { from: "2026-10-01", to: "2026-10-31" },
    isDefault: false,
  });
});

test("resolvePeriod узнаёт период по умолчанию, пришедший адресом", () => {
  assert.equal(resolvePeriod("2026-11-01", "2026-11-30", today).isDefault, true);
});

test("wholeMonths", () => {
  assert.equal(wholeMonths({ from: "2026-11-01", to: "2026-11-30" }), 1);
  assert.equal(wholeMonths({ from: "2026-01-01", to: "2026-12-31" }), 12);
  assert.equal(wholeMonths({ from: "2026-11-01", to: "2026-11-29" }), null);
  assert.equal(wholeMonths({ from: "2026-11-02", to: "2026-11-30" }), null);
});

test("shiftPeriod: месяц шагает на месяц с правильным концом", () => {
  assert.deepEqual(shiftPeriod({ from: "2026-03-01", to: "2026-03-31" }, -1), {
    from: "2026-02-01",
    to: "2026-02-28",
  });
  assert.deepEqual(shiftPeriod({ from: "2026-12-01", to: "2026-12-31" }, 1), {
    from: "2027-01-01",
    to: "2027-01-31",
  });
});

test("shiftPeriod: квартал и год шагают целиком", () => {
  assert.deepEqual(shiftPeriod({ from: "2026-07-01", to: "2026-09-30" }, 1), {
    from: "2026-10-01",
    to: "2026-12-31",
  });
  assert.deepEqual(shiftPeriod({ from: "2026-01-01", to: "2026-12-31" }, -1), {
    from: "2025-01-01",
    to: "2025-12-31",
  });
});

test("shiftPeriod: произвольные дни шагают на ту же длину", () => {
  assert.deepEqual(shiftPeriod({ from: "2026-11-16", to: "2026-11-22" }, 1), {
    from: "2026-11-23",
    to: "2026-11-29",
  });
  assert.deepEqual(shiftPeriod({ from: "2026-11-21", to: "2026-11-21" }, -1), {
    from: "2026-11-20",
    to: "2026-11-20",
  });
  // Через переход на зимнее время (последнее воскресенье октября в Европе).
  assert.deepEqual(shiftPeriod({ from: "2026-10-20", to: "2026-10-29" }, 1), {
    from: "2026-10-30",
    to: "2026-11-08",
  });
});

test("periodLabel", () => {
  assert.equal(periodLabel({ from: "2026-11-01", to: "2026-11-30" }, today), "ноябрь 2026");
  assert.equal(periodLabel({ from: "2026-07-01", to: "2026-09-30" }, today), "3 квартал 2026");
  assert.equal(periodLabel({ from: "2026-01-01", to: "2026-12-31" }, today), "2026 год");
  assert.equal(periodLabel({ from: "2026-11-16", to: "2026-11-22" }, today), "16–22 ноября");
  assert.equal(
    periodLabel({ from: "2026-10-28", to: "2026-11-03" }, today),
    "28 октября – 3 ноября",
  );
  assert.equal(periodLabel({ from: "2026-11-21", to: "2026-11-21" }, today), "21 ноября");
  assert.equal(periodLabel({ from: "2025-11-21", to: "2025-11-21" }, today), "21 ноября 2025");
  assert.equal(
    periodLabel({ from: "2025-12-25", to: "2026-01-05" }, today),
    "25 декабря 2025 – 5 января 2026",
  );
  assert.equal(
    periodLabel({ from: "2026-09-01", to: "2026-11-30" }, today),
    "сентябрь – ноябрь 2026",
  );
});

test("periodContains и nextIsoDay", () => {
  assert.equal(periodContains({ from: "2026-11-01", to: "2026-11-30" }, today), true);
  assert.equal(periodContains({ from: "2026-10-01", to: "2026-10-31" }, today), false);
  assert.equal(nextIsoDay("2026-11-30"), "2026-12-01");
  assert.equal(nextIsoDay("2026-12-31"), "2027-01-01");
});

test("пресеты дают корректные периоды", () => {
  const byLabel = Object.fromEntries(PERIOD_PRESETS.map((p) => [p.label, p.range(today)]));
  assert.deepEqual(byLabel["Прошлый месяц"], { from: "2026-10-01", to: "2026-10-31" });
  assert.deepEqual(byLabel["Эта неделя"], { from: "2026-11-16", to: "2026-11-22" });
  assert.deepEqual(byLabel["Последние 30 дней"], { from: "2026-10-23", to: "2026-11-21" });
  assert.deepEqual(byLabel["Этот квартал"], { from: "2026-10-01", to: "2026-12-31" });
  assert.deepEqual(byLabel["Прошлый год"], { from: "2025-01-01", to: "2025-12-31" });
});
