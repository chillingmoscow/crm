import test from "node:test";
import assert from "node:assert/strict";

import {
  NO_CATEGORY,
  NO_COUNTERPARTY,
  NO_VENUE,
  hasTransactionFilters,
  isoDateOrNull,
  parseSort,
  parseTransactionQuery,
} from "./transaction-query.ts";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";

const read = (params: Record<string, string>) => (key: string) => params[key];

test("пустой адрес: без условий, первая страница, 25 строк", () => {
  const q = parseTransactionQuery(read({}));
  assert.deepEqual(q.filters, {});
  assert.deepEqual(q.sort, []);
  assert.equal(q.page, 1);
  assert.equal(q.pageSize, 25);
  assert.equal(q.datePreset, null);
});

test("несколько счетов через запятую — массив, мусор и повторы отбрасываются", () => {
  const q = parseTransactionQuery(read({ bank_account_id: `${A},not-a-uuid,${B},${A}` }));
  assert.deepEqual(q.filters.bank_account_ids, [A, B]);
});

test("«Без статьи» и «Без контрагента» — отдельные флаги, рядом с id", () => {
  const q = parseTransactionQuery(
    read({ category_id: `${NO_CATEGORY},${A}`, counterparty_id: NO_COUNTERPARTY }),
  );
  assert.deepEqual(q.filters.category_ids, [A]);
  assert.equal(q.filters.category_none, true);
  assert.equal(q.filters.counterparty_ids, undefined);
  assert.equal(q.filters.counterparty_none, true);
});

test("тип только из списка", () => {
  assert.equal(parseTransactionQuery(read({ type: "income" })).filters.type, "income");
  assert.equal(parseTransactionQuery(read({ type: "refund" })).filters.type, undefined);
});

test("даты: только настоящие календарные", () => {
  assert.equal(isoDateOrNull("2026-11-20"), "2026-11-20");
  assert.equal(isoDateOrNull("2026-02-30"), null);
  assert.equal(isoDateOrNull("2026-13-01"), null);
  assert.equal(isoDateOrNull("foo"), null);
  const q = parseTransactionQuery(read({ date_from: "2026-11-01", date_to: "bad", date_preset: "Этот месяц" }));
  assert.equal(q.filters.date_from, "2026-11-01");
  assert.equal(q.filters.date_to, undefined);
  assert.equal(q.datePreset, "Этот месяц");
});

test("подпись пресета без дат не держится", () => {
  assert.equal(parseTransactionQuery(read({ date_preset: "Этот месяц" })).datePreset, null);
});

test("суммы: неотрицательные числа", () => {
  const q = parseTransactionQuery(read({ amount_min: "100", amount_max: "-5" }));
  assert.equal(q.filters.amount_min, 100);
  assert.equal(q.filters.amount_max, undefined);
  assert.equal(parseTransactionQuery(read({ amount_min: "abc" })).filters.amount_min, undefined);
  assert.equal(parseTransactionQuery(read({ amount_min: "0" })).filters.amount_min, 0);
});

test("удалённые — только когда разрешено", () => {
  assert.equal(parseTransactionQuery(read({ deleted: "1" })).filters.deleted, undefined);
  assert.equal(
    parseTransactionQuery(read({ deleted: "1" }), { allowDeleted: true }).filters.deleted,
    true,
  );
});

test("страница и размер: битые значения — по умолчанию", () => {
  assert.equal(parseTransactionQuery(read({ page: "-3" })).page, 1);
  assert.equal(parseTransactionQuery(read({ page: "4" })).page, 4);
  assert.equal(parseTransactionQuery(read({ size: "100" })).pageSize, 100);
  assert.equal(parseTransactionQuery(read({ size: "7" })).pageSize, 25);
});

test("сортировка: известные поля по приоритету, поле один раз, не больше трёх", () => {
  assert.deepEqual(parseSort("amount_desc,date_asc"), ["amount_desc", "date_asc"]);
  assert.deepEqual(parseSort("amount_desc,amount_asc,foo_asc,date_up"), ["amount_desc"]);
  assert.deepEqual(
    parseSort("date_asc,amount_asc,category_asc,account_asc"),
    ["date_asc", "amount_asc", "category_asc"],
  );
});

test("поиск обрезается по краям, пустой не считается", () => {
  assert.equal(parseTransactionQuery(read({ q: "  аренда " })).filters.q, "аренда");
  assert.equal(parseTransactionQuery(read({ q: "   " })).filters.q, undefined);
});

test("фильтры без поиска и режима удалённых", () => {
  assert.equal(hasTransactionFilters({}), false);
  assert.equal(hasTransactionFilters({ q: "x", deleted: true }), false);
  assert.equal(hasTransactionFilters({ amount_min: 0 }), true);
  assert.equal(hasTransactionFilters({ category_none: true }), true);
});

test("заведение: id или «Без заведения»", () => {
  assert.equal(parseTransactionQuery(read({ venue_id: A })).filters.venue_id, A);
  const none = parseTransactionQuery(read({ venue_id: NO_VENUE })).filters;
  assert.equal(none.venue_none, true);
  assert.equal(none.venue_id, undefined);
  assert.equal(parseTransactionQuery(read({ venue_id: "bad" })).filters.venue_id, undefined);
});

test("файлы: только with / without, это фильтр", () => {
  assert.equal(parseTransactionQuery(read({ files: "with" })).filters.files, "with");
  assert.equal(parseTransactionQuery(read({ files: "maybe" })).filters.files, undefined);
  assert.equal(hasTransactionFilters({ files: "without" }), true);
  assert.equal(hasTransactionFilters({ venue_none: true }), true);
});
