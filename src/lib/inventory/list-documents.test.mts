import assert from "node:assert/strict";
import test from "node:test";

import {
  buildRpcArgs,
  isRecountFilter,
  normalizeListOptions,
  parseRpcResponse,
  DEFAULT_PAGE_SIZE,
  DEFAULT_SORT,
  MAX_PAGE_SIZE,
} from "./list-documents-shared.ts";

test("normalizeListOptions: defaults", () => {
  const n = normalizeListOptions();
  assert.deepEqual(n.sort, DEFAULT_SORT);
  // DEFAULT_SORT теперь пустой — сервер сам падает на date_desc через
  // fallback в RPC при null/empty p_sort.
  assert.deepEqual(n.sort, []);
  assert.equal(n.page, 1);
  assert.equal(n.pageSize, DEFAULT_PAGE_SIZE);
  assert.deepEqual(n.filters, {});
});

test("normalizeListOptions: пустой sort массив → DEFAULT_SORT", () => {
  const n = normalizeListOptions({ sort: [] });
  assert.deepEqual(n.sort, DEFAULT_SORT);
  assert.deepEqual(n.sort, []);
});

test("normalizeListOptions: multi-sort пробрасывается как есть", () => {
  const n = normalizeListOptions({ sort: ["number_asc", "date_desc"] });
  assert.deepEqual(n.sort, ["number_asc", "date_desc"]);
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
  assert.equal(args.p_filter_recount, null);
  assert.deepEqual(args.p_sort, []);
  assert.equal(args.p_page, 1);
  assert.equal(args.p_page_size, 25);
});

test("buildRpcArgs: фильтр пересчётов — 'any' равносилен его отсутствию", () => {
  // RPC трактует NULL как «без отбора», поэтому гонять 'any' по проводам не за
  // чем: два разных представления одного и того же состояния разошлись бы при
  // первой же правке условия в SQL.
  assert.equal(buildRpcArgs(normalizeListOptions({ filters: { recount: "any" } })).p_filter_recount, null);
  assert.equal(buildRpcArgs(normalizeListOptions({ filters: {} })).p_filter_recount, null);
});

test("buildRpcArgs: 'only' и 'exclude' пробрасываются как есть", () => {
  assert.equal(
    buildRpcArgs(normalizeListOptions({ filters: { recount: "only" } })).p_filter_recount,
    "only",
  );
  assert.equal(
    buildRpcArgs(normalizeListOptions({ filters: { recount: "exclude" } })).p_filter_recount,
    "exclude",
  );
});

test("isRecountFilter: принимает только известные значения", () => {
  assert.equal(isRecountFilter("only"), true);
  assert.equal(isRecountFilter("exclude"), true);
  assert.equal(isRecountFilter("any"), true);
  assert.equal(isRecountFilter("recount"), false);
  assert.equal(isRecountFilter(""), false);
  assert.equal(isRecountFilter(undefined), false);
});

test("buildRpcArgs: пустой массив (status/store) → null", () => {
  const args = buildRpcArgs(
    normalizeListOptions({ filters: { status: [], store: [] } }),
  );
  assert.equal(args.p_filter_status, null);
  assert.equal(args.p_filter_store, null);
});

test("buildRpcArgs: непустые массивы пробрасываются", () => {
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

test("buildRpcArgs: sort пробрасывается, default = []", () => {
  assert.deepEqual(buildRpcArgs(normalizeListOptions()).p_sort, []);
  assert.deepEqual(
    buildRpcArgs(normalizeListOptions({ sort: ["number_desc"] })).p_sort,
    ["number_desc"],
  );
  assert.deepEqual(
    buildRpcArgs(normalizeListOptions({ sort: ["number_asc", "date_desc"] })).p_sort,
    ["number_asc", "date_desc"],
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
