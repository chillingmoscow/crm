import test from "node:test";
import assert from "node:assert/strict";
import { processOfficialRun } from "./official-run.ts";

const base = { account_id: "a1", venue_id: "v1", month: "2026-11-01" };

test("пустой результат — ни событий, ни сбоя", () => {
  for (const raw of [[], null, undefined, {}]) {
    const r = processOfficialRun(raw);
    assert.deepEqual(r.events, []);
    assert.equal(r.failed, false);
  }
});

test("успех — одно событие на заведение, без сбоя", () => {
  const r = processOfficialRun([
    { ...base, posted: 2, review: 1, amount: 100000, errors: [] },
    { ...base, venue_id: "v2", posted: 0, review: 0, amount: 0, errors: [] },
  ]);
  assert.equal(r.failed, false);
  assert.equal(r.events.length, 1);
  const e = r.events[0];
  assert.equal(e.actionCode, "payroll.official_run.created");
  assert.equal(e.userId, null);
  assert.equal(e.venueId, "v1");
  assert.deepEqual(e.details, { month: "2026-11-01", posted: 2, review: 1, amount: 100000 });
  assert.deepEqual(r.totals, { venues: 1, posted: 2, review: 1, amount: 100000, errors: 0 });
});

test("падение заведения — событие с error и сбой", () => {
  const r = processOfficialRun([{ ...base, posted: 0, review: 0, amount: 0, error: "boom" }]);
  assert.equal(r.failed, true);
  assert.equal(r.events.length, 1);
  assert.equal(r.events[0].details.error, "boom");
  assert.equal(r.totals.errors, 1);
});

test("ошибки сотрудников — сбой, но успешная часть записана", () => {
  const errors = [{ employment_id: "e1", message: "bad" }];
  const r = processOfficialRun([{ ...base, posted: 1, review: 0, amount: 500, errors }]);
  assert.equal(r.failed, true);
  assert.equal(r.events.length, 1);
  assert.deepEqual(r.events[0].details.errors, errors);
  assert.equal(r.events[0].details.posted, 1);
});

test("заведение только с ошибками тоже пишется в журнал", () => {
  const r = processOfficialRun([{ ...base, posted: 0, review: 0, amount: 0, errors: [{ message: "x" }] }]);
  assert.equal(r.failed, true);
  assert.equal(r.events.length, 1);
});
