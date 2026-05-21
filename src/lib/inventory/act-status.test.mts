import assert from "node:assert/strict";
import test from "node:test";

import {
  FORM_LOCKED_STATUSES,
  isInventoryFormLocked,
  isInventoryResultAdjustLocked,
  isInventoryResultLocked,
  type InventoryActStatus,
} from "./act-status.ts";

const OPEN = { results_finalized_at: null, results_reopened_at: null };

// Матрица доступа из docs/handbook/inventory/statuses.md.
// formLocked — форма заполнения только для чтения.
// adjustLocked — инструменты ревьюера (пересорт/исключение/финализация) закрыты.
const MATRIX: Array<{
  status: InventoryActStatus;
  formLocked: boolean;
  adjustLocked: boolean;
}> = [
  { status: "synced", formLocked: false, adjustLocked: false },
  { status: "assigned", formLocked: false, adjustLocked: false },
  { status: "in_progress", formLocked: false, adjustLocked: false },
  { status: "ready_for_review", formLocked: true, adjustLocked: false },
  { status: "results_blocked", formLocked: true, adjustLocked: false },
  // Пересчёт: форма снова открыта исполнителю, итоги закрыты для ревьюера.
  { status: "recount_pending", formLocked: false, adjustLocked: true },
  { status: "processed", formLocked: true, adjustLocked: true },
  { status: "sync_error", formLocked: true, adjustLocked: false },
];

for (const row of MATRIX) {
  test(`form lock: ${row.status} → ${row.formLocked}`, () => {
    assert.equal(isInventoryFormLocked(row.status, false), row.formLocked);
  });

  test(`adjust lock: ${row.status} → ${row.adjustLocked}`, () => {
    assert.equal(
      isInventoryResultAdjustLocked({ ...OPEN, status: row.status }),
      row.adjustLocked,
    );
  });
}

test("финализация лочит форму в любом статусе", () => {
  for (const row of MATRIX) {
    assert.equal(isInventoryFormLocked(row.status, true), true);
  }
});

test("финализация лочит итоги в любом статусе", () => {
  for (const row of MATRIX) {
    assert.equal(
      isInventoryResultAdjustLocked({
        status: row.status,
        results_finalized_at: "2026-05-21T00:00:00Z",
        results_reopened_at: null,
      }),
      true,
    );
  }
});

test("проведённый акт залочен, разблокированный — нет", () => {
  assert.equal(
    isInventoryResultLocked({ status: "processed", results_finalized_at: null, results_reopened_at: null }),
    true,
  );
  assert.equal(
    isInventoryResultLocked({
      status: "processed",
      results_finalized_at: null,
      results_reopened_at: "2026-05-21T00:00:00Z",
    }),
    false,
  );
  // …но разблокированный проведённый акт всё равно держит форму закрытой.
  assert.equal(isInventoryFormLocked("processed", false), true);
});

test("recount_pending: итоги закрыты даже без финализации/проведения", () => {
  assert.equal(isInventoryResultLocked({ ...OPEN, status: "recount_pending" }), false);
  assert.equal(isInventoryResultAdjustLocked({ ...OPEN, status: "recount_pending" }), true);
});

test("FORM_LOCKED_STATUSES не содержит редактируемых статусов", () => {
  for (const s of ["synced", "assigned", "in_progress", "recount_pending"]) {
    assert.equal(FORM_LOCKED_STATUSES.includes(s), false);
  }
});
