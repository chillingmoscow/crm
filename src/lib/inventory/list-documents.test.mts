import assert from "node:assert/strict";
import test from "node:test";

import {
  buildRpcArgs,
  normalizeListOptions,
  parseRpcResponse,
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
} from "./list-documents-shared.ts";

test("normalizeListOptions: defaults", () => {
  const n = normalizeListOptions();
  assert.equal(n.sort, "inbox");
  assert.equal(n.page, 1);
  assert.equal(n.pageSize, DEFAULT_PAGE_SIZE);
  assert.deepEqual(n.filters, {});
});

test("normalizeListOptions: page clamped to >= 1", () => {
  assert.equal(normalizeListOptions({ page: 0 }).page, 1);
  assert.equal(normalizeListOptions({ page: -5 }).page, 1);
  assert.equal(normalizeListOptions({ page: 3 }).page, 3);
});

test("normalizeListOptions: pageSize clamped to [1, 200]", () => {
  assert.equal(normalizeListOptions({ pageSize: 0 }).pageSize, 1);
  assert.equal(normalizeListOptions({ pageSize: -10 }).pageSize, 1);
  assert.equal(normalizeListOptions({ pageSize: 50 }).pageSize, 50);
  assert.equal(normalizeListOptions({ pageSize: 9999 }).pageSize, MAX_PAGE_SIZE);
});

test("buildRpcArgs: empty filters → all params null", () => {
  const args = buildRpcArgs(normalizeListOptions());
  assert.equal(args.p_filter_venue, null);
  assert.equal(args.p_filter_status, null);
  assert.equal(args.p_filter_assigned, null);
  assert.equal(args.p_filter_store, null);
  assert.equal(args.p_filter_date_from, null);
  assert.equal(args.p_filter_date_to, null);
  assert.equal(args.p_filter_q, null);
  assert.equal(args.p_sort, "inbox");
  assert.equal(args.p_page, 1);
  assert.equal(args.p_page_size, 25);
});

test("buildRpcArgs: empty arrays → null (не отправляем пустой массив)", () => {
  const args = buildRpcArgs(
    normalizeListOptions({ filters: { status: [], store: [] } }),
  );
  assert.equal(args.p_filter_status, null);
  assert.equal(args.p_filter_store, null);
});

test("buildRpcArgs: непустые массивы пробрасываются как есть", () => {
  const args = buildRpcArgs(
    normalizeListOptions({
      filters: {
        status: ["assigned", "in_progress"],
        store: ["store-uuid-1", "store-uuid-2"],
      },
    }),
  );
  assert.deepEqual(args.p_filter_status, ["assigned", "in_progress"]);
  assert.deepEqual(args.p_filter_store, ["store-uuid-1", "store-uuid-2"]);
});

test("buildRpcArgs: assigned sentinel 'me' пробрасывается, раскрытие на сервере", () => {
  const args = buildRpcArgs(normalizeListOptions({ filters: { assigned: "me" } }));
  assert.equal(args.p_filter_assigned, "me");
});

test("buildRpcArgs: venue 'unassigned' sentinel пробрасывается", () => {
  const args = buildRpcArgs(normalizeListOptions({ filters: { venue: "unassigned" } }));
  assert.equal(args.p_filter_venue, "unassigned");
});

test("buildRpcArgs: q — пробрасывается как есть (валидация длины — на сервере)", () => {
  const args1 = buildRpcArgs(normalizeListOptions({ filters: { q: "" } }));
  assert.equal(args1.p_filter_q, "");
  const args2 = buildRpcArgs(normalizeListOptions({ filters: { q: "coca" } }));
  assert.equal(args2.p_filter_q, "coca");
});

test("buildRpcArgs: даты пробрасываются как ISO-строки", () => {
  const args = buildRpcArgs(
    normalizeListOptions({
      filters: { date_from: "2026-05-01", date_to: "2026-05-31" },
    }),
  );
  assert.equal(args.p_filter_date_from, "2026-05-01");
  assert.equal(args.p_filter_date_to, "2026-05-31");
});

test("buildRpcArgs: sort пробрасывается, default inbox", () => {
  assert.equal(buildRpcArgs(normalizeListOptions()).p_sort, "inbox");
  assert.equal(
    buildRpcArgs(normalizeListOptions({ sort: "date_desc" })).p_sort,
    "date_desc",
  );
});

test("parseRpcResponse: пустой массив → total=0, rows=[]", () => {
  const r1 = parseRpcResponse([]);
  assert.equal(r1.total, 0);
  assert.deepEqual(r1.rows, []);
  const r2 = parseRpcResponse(null);
  assert.equal(r2.total, 0);
  assert.deepEqual(r2.rows, []);
});

test("parseRpcResponse: total берётся из первой строки, поле total убирается из rows", () => {
  const fakeRow = {
    total: 42,
    id: "doc-1",
    document_number: "CB-1",
    invoice_date: "2026-05-20",
    status: "assigned",
    processed: false,
    assigned_to: null,
    shortfall_sum: null,
    surplus_sum: null,
    results_has_line_amounts: false,
    store_id: null,
    store_title: null,
    venue_id: null,
    comment: null,
    matched_ingredients: null,
  };
  const r = parseRpcResponse([fakeRow]);
  assert.equal(r.total, 42);
  assert.equal(r.rows.length, 1);
  assert.equal(r.rows[0].id, "doc-1");
  // total в самих строках мы не оставляем
  assert.ok(!("total" in r.rows[0]));
});

test("parseRpcResponse: total строкой ('42') корректно парсится в число", () => {
  const row = {
    total: "42",
    id: "doc-1",
    document_number: "CB-1",
    invoice_date: null,
    status: "synced",
    processed: false,
    assigned_to: null,
    shortfall_sum: null,
    surplus_sum: null,
    results_has_line_amounts: false,
    store_id: null,
    store_title: null,
    venue_id: null,
    comment: null,
    matched_ingredients: null,
  };
  const r = parseRpcResponse([row]);
  assert.equal(r.total, 42);
});

test("parseRpcResponse: matched_ingredients прокидывается без изменений", () => {
  const row = {
    total: 1,
    id: "doc-1",
    document_number: "CB-1",
    invoice_date: null,
    status: "synced",
    processed: false,
    assigned_to: null,
    shortfall_sum: null,
    surplus_sum: null,
    results_has_line_amounts: false,
    store_id: null,
    store_title: null,
    venue_id: null,
    comment: null,
    matched_ingredients: ["Coca-Cola", "Coca-Cola Zero"],
  };
  const r = parseRpcResponse([row]);
  assert.deepEqual(r.rows[0].matched_ingredients, ["Coca-Cola", "Coca-Cola Zero"]);
});
