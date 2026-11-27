import assert from "node:assert/strict";
import test from "node:test";

import {
  combineSort,
  formatDate,
  getDocHref,
  groupsByDate,
  netResultsTotal,
  sortToDirection,
  sortToField,
  toIsoDate,
} from "./documents-table-utils.ts";

test("sortToField маппит режим на поле", () => {
  assert.equal(sortToField("date_desc"), "date");
  assert.equal(sortToField("date_asc"), "date");
  assert.equal(sortToField("number_desc"), "number");
  assert.equal(sortToField("number_asc"), "number");
  assert.equal(sortToField("status_desc"), "status");
  assert.equal(sortToField("status_asc"), "status");
});

test("sortToDirection читает направление из суффикса", () => {
  assert.equal(sortToDirection("date_asc"), "asc");
  assert.equal(sortToDirection("status_desc"), "desc");
});

test("combineSort собирает режим из поля и направления (round-trip)", () => {
  for (const mode of ["date_desc", "date_asc", "number_desc", "number_asc", "status_desc", "status_asc"] as const) {
    assert.equal(combineSort(sortToField(mode), sortToDirection(mode)), mode);
  }
});

test("getDocHref: акт со сданными итогами + право → /results", () => {
  const base = { id: "d1", processed: false, results_has_line_amounts: true, status: "assigned" };
  for (const status of ["processed", "results_blocked", "ready_for_review", "recount_pending"] as const) {
    assert.equal(getDocHref({ ...base, status }, true), "/documents/inventory/d1/results");
  }
});

test("getDocHref: акт ещё не сдан → форма, даже если QR вернул построчные расчёты", () => {
  // Quick Resto выставляет results_has_line_amounts и на нетронутом акте:
  // разница там равна минус складскому остатку. Уводить на «Итоги» нельзя —
  // там заглушка «Подсчёт ещё не завершён».
  const base = { id: "d1", processed: false, results_has_line_amounts: true, status: "assigned" };
  for (const status of ["synced", "assigned", "in_progress"] as const) {
    assert.equal(getDocHref({ ...base, status }, true), "/documents/inventory/d1");
  }
});

test("getDocHref: без права view_results → форма (fill-only не уносит на /results)", () => {
  const doc = { id: "d2", processed: true, results_has_line_amounts: true, status: "processed" };
  assert.equal(getDocHref(doc, false), "/documents/inventory/d2");
});

test("getDocHref: не-results-состояние → форма", () => {
  const doc = { id: "d3", processed: false, results_has_line_amounts: false, status: "assigned" };
  assert.equal(getDocHref(doc, true), "/documents/inventory/d3");
});

test("formatDate: null → тире, валидная дата → ru-формат", () => {
  assert.equal(formatDate(null), "—");
  assert.match(formatDate("2026-05-22T00:00:00Z"), /^\d{2}\.\d{2}\.\d{4}$/);
});

test("toIsoDate: локальная дата → yyyy-mm-dd", () => {
  assert.equal(toIsoDate(new Date(2026, 4, 22)), "2026-05-22");
  assert.equal(toIsoDate(new Date(2026, 0, 3)), "2026-01-03");
});

test("sortModesToSorting / sortingToSortModes — round-trip с порядком приоритета", async () => {
  const { sortModesToSorting, sortingToSortModes } = await import("./documents-table-utils.ts");
  const modes = ["status_asc", "date_desc", "number_asc"] as const;
  const sorting = sortModesToSorting([...modes]);
  assert.deepEqual(sorting, [
    { id: "status", desc: false },
    { id: "invoice_date", desc: true },
    { id: "document_number", desc: false },
  ]);
  assert.deepEqual(sortingToSortModes(sorting), [...modes]);
});

test("sortingToSortModes пропускает чужие столбцы и повторы поля", async () => {
  const { sortingToSortModes } = await import("./documents-table-utils.ts");
  assert.deepEqual(
    sortingToSortModes([
      { id: "comment", desc: false },
      { id: "invoice_date", desc: false },
      { id: "invoice_date", desc: true },
    ]),
    ["date_asc"],
  );
});

test("groupsByDate: по умолчанию и при сортировке по дате — да, по номеру или статусу — нет", () => {
  assert.equal(groupsByDate([]), true);
  assert.equal(groupsByDate(["date_desc"]), true);
  assert.equal(groupsByDate(["date_asc", "number_asc"]), true);
  assert.equal(groupsByDate(["number_asc", "date_desc"]), false);
  assert.equal(groupsByDate(["status_desc"]), false);
});

test("netResultsTotal: только сданные акты с расчётом, сбой итога — без суммы", () => {
  const row = (patch: Record<string, unknown>) => ({
    results_has_line_amounts: true,
    status: "processed",
    totals_unavailable: false,
    surplus_sum: 0,
    shortfall_sum: 0,
    ...patch,
  });
  assert.deepEqual(
    netResultsTotal([
      row({ surplus_sum: 100, shortfall_sum: 300 }),
      row({ surplus_sum: 50 }),
      // Не сдан: «разница» Quick Resto — минус остаток, в итог не идёт.
      row({ status: "assigned", shortfall_sum: 99999 }),
      row({ results_has_line_amounts: false, shortfall_sum: 10 }),
    ]),
    { net: -150, counted: 2, unavailable: false },
  );
  assert.equal(netResultsTotal([row({ totals_unavailable: true })]).unavailable, true);
});
