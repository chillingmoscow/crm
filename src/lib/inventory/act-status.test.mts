import assert from "node:assert/strict";
import test from "node:test";

import {
  FORM_LOCKED_STATUSES,
  getAssigneeLockReason,
  getInventoryResultAdjustLockReason,
  getReviewerLockReason,
  isInventoryFormLocked,
  isInventoryResultAdjustLocked,
  isInventoryResultLocked,
  nextStatusAfterAssign,
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

test("adjust lock reason: non-null ровно когда итоги залочены", () => {
  for (const row of MATRIX) {
    const open = { ...OPEN, status: row.status };
    assert.equal(
      getInventoryResultAdjustLockReason(open) !== null,
      isInventoryResultAdjustLocked(open),
    );
    const finalized = {
      status: row.status,
      results_finalized_at: "2026-05-21T00:00:00Z",
      results_reopened_at: null,
    };
    assert.equal(
      getInventoryResultAdjustLockReason(finalized) !== null,
      isInventoryResultAdjustLocked(finalized),
    );
  }
});

test("adjust lock reason: разные тексты для пересчёта / финализации / проведения", () => {
  assert.match(getInventoryResultAdjustLockReason({ ...OPEN, status: "recount_pending" }) ?? "", /пересч/i);
  assert.match(
    getInventoryResultAdjustLockReason({ status: "ready_for_review", results_finalized_at: "2026-05-21T00:00:00Z", results_reopened_at: null }) ?? "",
    /финализ/i,
  );
  assert.match(getInventoryResultAdjustLockReason({ ...OPEN, status: "processed" }) ?? "", /проведён/i);
});

test("FORM_LOCKED_STATUSES не содержит редактируемых статусов", () => {
  for (const s of ["synced", "assigned", "in_progress", "recount_pending"]) {
    assert.equal(FORM_LOCKED_STATUSES.includes(s), false);
  }
});

// Замок исполнителя = фаза заполнения (как форма): меняем при
// synced/assigned/in_progress/recount_pending, лочим после ухода на проверку.
const ASSIGNEE_LOCK: Array<{ status: InventoryActStatus; locked: boolean }> = [
  { status: "synced", locked: false },
  { status: "assigned", locked: false },
  { status: "in_progress", locked: false },
  { status: "recount_pending", locked: false },
  { status: "ready_for_review", locked: true },
  { status: "results_blocked", locked: true },
  { status: "processed", locked: true },
  { status: "sync_error", locked: true },
];

for (const row of ASSIGNEE_LOCK) {
  test(`assignee lock: ${row.status} → ${row.locked}`, () => {
    assert.equal(getAssigneeLockReason(row.status) !== null, row.locked);
  });
}

test("замок исполнителя совпадает с замком формы (по статусу)", () => {
  for (const row of ASSIGNEE_LOCK) {
    assert.equal(getAssigneeLockReason(row.status) !== null, isInventoryFormLocked(row.status, false));
  }
});

// Замок проверяющего: менять можно вплоть до проведения; лок только на
// processed / sync_error.
const REVIEWER_LOCK: Array<{ status: InventoryActStatus; locked: boolean }> = [
  { status: "synced", locked: false },
  { status: "assigned", locked: false },
  { status: "in_progress", locked: false },
  { status: "recount_pending", locked: false },
  { status: "ready_for_review", locked: false },
  { status: "results_blocked", locked: false },
  { status: "processed", locked: true },
  { status: "sync_error", locked: true },
];

for (const row of REVIEWER_LOCK) {
  test(`reviewer lock: ${row.status} → ${row.locked}`, () => {
    assert.equal(getReviewerLockReason(row.status) !== null, row.locked);
  });
}

test("исполнитель строже проверяющего: на проверке исполнитель залочен, проверяющий — нет", () => {
  for (const s of ["ready_for_review", "results_blocked"] as const) {
    assert.equal(getAssigneeLockReason(s) !== null, true);
    assert.equal(getReviewerLockReason(s) !== null, false);
  }
});

test("nextStatusAfterAssign: снятие исполнителя → synced", () => {
  for (const s of ["synced", "assigned", "in_progress", "recount_pending"] as const) {
    assert.equal(nextStatusAfterAssign(s, null), "synced");
  }
});

test("nextStatusAfterAssign: смена на пересчёте сохраняет recount_pending", () => {
  assert.equal(nextStatusAfterAssign("recount_pending", "user-1"), "recount_pending");
});

test("nextStatusAfterAssign: обычное назначение → assigned", () => {
  for (const s of ["synced", "assigned", "in_progress"] as const) {
    assert.equal(nextStatusAfterAssign(s, "user-1"), "assigned");
  }
});
