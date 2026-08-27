import assert from "node:assert/strict";
import test from "node:test";

import {
  combineSort,
  formatDate,
  getDocHref,
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
  for (const status of ["synced", "assigned", "in_progress", "sync_error"] as const) {
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
