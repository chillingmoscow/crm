import { test } from "node:test";
import assert from "node:assert/strict";

import {
  ALL_TIME,
  currentPeriod,
  isBeforeMinPeriod,
  isFuturePeriod,
  parsePeriod,
  periodLabel,
  periodParam,
  periodPhrase,
  periodRange,
  shiftPeriod,
  transactionsHref,
} from "./period.ts";

test("адрес ↔ период: месяц, квартал, год, всё время", () => {
  for (const param of ["2026-11", "2026-Q4", "2026"]) {
    assert.equal(periodParam(parsePeriod(param)), param);
  }
  assert.deepEqual(parsePeriod(null), ALL_TIME);
  assert.deepEqual(parsePeriod(""), ALL_TIME);
  assert.equal(periodParam(ALL_TIME), null);
});

test("битый параметр — всё время, страница не падает", () => {
  for (const bad of ["2026-13", "2026-00", "2026-Q5", "foo", "1999", "2026-1", "26-11"]) {
    assert.deepEqual(parsePeriod(bad), ALL_TIME, bad);
  }
});

test("границы периода включительно, с учётом високосного февраля", () => {
  assert.deepEqual(periodRange(parsePeriod("2028-02")), { from: "2028-02-01", to: "2028-02-29" });
  assert.deepEqual(periodRange(parsePeriod("2026-02")), { from: "2026-02-01", to: "2026-02-28" });
  assert.deepEqual(periodRange(parsePeriod("2026-Q4")), { from: "2026-10-01", to: "2026-12-31" });
  assert.deepEqual(periodRange(parsePeriod("2026-Q1")), { from: "2026-01-01", to: "2026-03-31" });
  assert.deepEqual(periodRange(parsePeriod("2026")), { from: "2026-01-01", to: "2026-12-31" });
  assert.deepEqual(periodRange(ALL_TIME), { from: null, to: null });
});

test("стрелки листают через границу года", () => {
  assert.equal(periodParam(shiftPeriod(parsePeriod("2026-01"), -1)), "2025-12");
  assert.equal(periodParam(shiftPeriod(parsePeriod("2026-12"), 1)), "2027-01");
  assert.equal(periodParam(shiftPeriod(parsePeriod("2026-Q1"), -1)), "2025-Q4");
  assert.equal(periodParam(shiftPeriod(parsePeriod("2026-Q4"), 1)), "2027-Q1");
  assert.equal(periodParam(shiftPeriod(parsePeriod("2026"), -1)), "2025");
  assert.deepEqual(shiftPeriod(ALL_TIME, 1), ALL_TIME);
});

test("текущий период и края диапазона", () => {
  const today = "2026-11-21";
  assert.equal(periodParam(currentPeriod("month", today)), "2026-11");
  assert.equal(periodParam(currentPeriod("quarter", today)), "2026-Q4");
  assert.equal(periodParam(currentPeriod("year", today)), "2026");
  assert.deepEqual(currentPeriod("all", today), ALL_TIME);

  assert.equal(isFuturePeriod(parsePeriod("2026-11"), today), false);
  assert.equal(isFuturePeriod(parsePeriod("2026-12"), today), true);
  assert.equal(isFuturePeriod(parsePeriod("2027-Q1"), today), true);
  assert.equal(isFuturePeriod(ALL_TIME, today), false);

  assert.equal(isBeforeMinPeriod(shiftPeriod(parsePeriod("2015-01"), -1)), true);
  assert.equal(isBeforeMinPeriod(parsePeriod("2015-01")), false);
});

test("подписи периода", () => {
  assert.equal(periodLabel(parsePeriod("2026-11")), "ноябрь 2026");
  assert.equal(periodLabel(parsePeriod("2026-Q4")), "IV квартал 2026");
  assert.equal(periodLabel(parsePeriod("2026")), "2026 год");
  assert.equal(periodPhrase(ALL_TIME), "за всё время");
  assert.equal(periodPhrase(parsePeriod("2026-Q2")), "за II квартал 2026");
});

test("ссылка на «Транзакции» несёт даты периода", () => {
  assert.equal(
    transactionsHref({ category_id: "c1" }, parsePeriod("2026-11")),
    "/finance/transactions?category_id=c1&date_from=2026-11-01&date_to=2026-11-30",
  );
  assert.equal(
    transactionsHref({ counterparty_id: "p1" }, ALL_TIME),
    "/finance/transactions?counterparty_id=p1",
  );
});
