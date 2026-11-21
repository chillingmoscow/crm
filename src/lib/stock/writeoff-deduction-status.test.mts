import { test } from "node:test";
import assert from "node:assert/strict";

import {
  currentWriteoffSources,
  writeoffDeductionStatus,
} from "./writeoff-deduction-status.ts";
import {
  writeoffBulkSummary,
  writeoffJournalNumbers,
  writeoffJournalPayer,
} from "./writeoff-journal.ts";

const V = "venue-1";
const doc = (external_id: number, amount: number | null, business_date = "2026-11-05", extra: Record<string, unknown> = {}) => ({
  venue_id: V,
  external_id,
  business_date,
  missing_at: null,
  payload: { processed: true, kind: "team", lines: [{ id: 1, amount }], ...extra },
});

const base = {
  venueId: V,
  month: "2026-11-01",
  documents: [doc(1, 100.2), doc(2, 50), doc(3, 30, "2026-10-31")],
  assignments: [
    { venue_id: V, external_id: 1, pool: "shared" as const, key: null },
    { venue_id: V, external_id: 2, pool: "department" as const, key: "bar" },
  ],
  departments: [{ id: "bar", archived: false }],
};

const postedFrom = (input: typeof base, extra: unknown[] = []) => ({
  capturedAt: "2026-11-20T10:00:00Z",
  reversedAt: null,
  sources: [...currentWriteoffSources(input).sources, ...extra],
});

test("источники месяца: только акты месяца, суммы вверх до рубля, со знаком недостачи", () => {
  const r = currentWriteoffSources(base);
  assert.deepEqual(r.unresolved, []);
  assert.deepEqual(
    r.sources.map((s) => [s.sourceRef, s.pool, s.key, s.amount]),
    [
      [`writeoff:${V}:1`, "shared", null, -101],
      [`writeoff:${V}:2`, "department", "bar", -50],
    ],
  );
});

test("снимка нет или он сторнирован → не посчитано", () => {
  const now = currentWriteoffSources(base);
  assert.deepEqual(writeoffDeductionStatus(null, now), { state: "not_posted", reversedAt: null });
  assert.deepEqual(
    writeoffDeductionStatus({ ...postedFrom(base), reversedAt: "2026-11-21T00:00:00Z" }, now),
    { state: "not_posted", reversedAt: "2026-11-21T00:00:00Z" },
  );
});

test("разнесение не менялось → посчитано; источники инвентаризации в снимке не мешают", () => {
  const inventory = { pool: "shared", key: null, amount: -500, sourceRef: "inventory:act-1" };
  assert.deepEqual(
    writeoffDeductionStatus(postedFrom(base, [inventory]), currentWriteoffSources(base)),
    { state: "posted", capturedAt: "2026-11-20T10:00:00Z" },
  );
});

test("сменили плательщика после расчёта → устарело", () => {
  const posted = postedFrom(base);
  const changed = {
    ...base,
    assignments: [base.assignments[0], { venue_id: V, external_id: 2, pool: "shared" as const, key: null }],
  };
  assert.deepEqual(writeoffDeductionStatus(posted, currentWriteoffSources(changed)), {
    state: "stale",
    capturedAt: "2026-11-20T10:00:00Z",
    unresolved: 0,
  });
});

test("подразделение ушло в архив или пометку сняли → устарело, с числом неразнесённых", () => {
  const posted = postedFrom(base);
  const archived = { ...base, departments: [{ id: "bar", archived: true }] };
  assert.deepEqual(writeoffDeductionStatus(posted, currentWriteoffSources(archived)), {
    state: "stale",
    capturedAt: "2026-11-20T10:00:00Z",
    unresolved: 1,
  });
});

test("новый акт или изменённая сумма после расчёта → устарело", () => {
  const posted = postedFrom(base);
  const more = {
    ...base,
    documents: [...base.documents, doc(4, 10)],
    assignments: [...base.assignments, { venue_id: V, external_id: 4, pool: "excluded" as const, key: null }],
  };
  // «Не удерживать» источника не даёт: расчёт тот же.
  assert.equal(writeoffDeductionStatus(posted, currentWriteoffSources(more)).state, "posted");
  const priced = { ...base, documents: [doc(1, 120), doc(2, 50)] };
  assert.equal(writeoffDeductionStatus(posted, currentWriteoffSources(priced)).state, "stale");
});

test("снимок без читаемых источников не выдаётся за актуальный", () => {
  assert.equal(
    writeoffDeductionStatus({ capturedAt: "x", reversedAt: null, sources: null }, currentWriteoffSources(base)).state,
    "stale",
  );
  assert.equal(
    writeoffDeductionStatus(
      { capturedAt: "x", reversedAt: null, sources: [{ sourceRef: `writeoff:${V}:1`, pool: "shared" }] },
      currentWriteoffSources(base),
    ).state,
    "stale",
  );
});

// countRu ставит неразрывный пробел между числом и словом.
const plain = (r: { title: string; description: string | null }) => ({
  title: r.title.replace(/\u00a0/g, " "),
  description: r.description,
});

test("итог массового разнесения", () => {
  assert.deepEqual(plain(writeoffBulkSummary({ applied: 5, unchanged: 0, notCounted: 0, notFound: 0 })), {
    title: "Разнесено: 5 актов",
    description: null,
  });
  assert.deepEqual(plain(writeoffBulkSummary({ applied: 1, unchanged: 2, notCounted: 1, notFound: 0 })), {
    title: "Разнесено: 1 акт, пропущено: 3 акта",
    description: "Уже с этим плательщиком: 2; черновики и акты, которых нет в Quick Resto: 1",
  });
  assert.equal(
    plain(writeoffBulkSummary({ applied: 0, unchanged: 0, notCounted: 0, notFound: 2 })).title,
    "Разнесено: 0 актов, пропущено: 2 акта",
  );
});

test("плательщик в журнале: с именем из новых строк и без имени из старых", () => {
  assert.equal(writeoffJournalPayer({ pool: "shared", key: null }), "Вся команда");
  assert.equal(writeoffJournalPayer({ pool: "excluded" }), "Не удерживать");
  assert.equal(writeoffJournalPayer({ pool: "department", key: "d", name: "Бар" }), "Подразделение: Бар");
  assert.equal(writeoffJournalPayer({ pool: "department", key: "d" }), "Подразделение");
  assert.equal(writeoffJournalPayer({ pool: "personal", key: "e", name: null }), "Сотрудник");
  assert.equal(writeoffJournalPayer(null), null);
  assert.equal(writeoffJournalPayer({ pool: "что-то" }), null);
});

test("номера актов массового разнесения", () => {
  const list = Array.from({ length: 7 }, (_, i) => ({ number: String(i + 1) }));
  assert.equal(writeoffJournalNumbers(list), "№ 1, № 2, № 3, № 4, № 5 и ещё 2");
  assert.equal(writeoffJournalNumbers([{ number: "12" }, {}]), "№ 12, без номера");
  assert.equal(writeoffJournalNumbers([]), null);
});
