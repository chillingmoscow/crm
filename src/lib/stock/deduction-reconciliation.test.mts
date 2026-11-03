import { test } from "node:test";
import assert from "node:assert/strict";
import { reconcileDeduction } from "./deduction-reconciliation.ts";

const AT_SHEERLY = "2026-11-03T09:00:00.000Z";
const AT_SHEET = "2026-11-03T09:05:00.000Z";

const side = (
  capturedAt: string,
  entries: Array<{ employeeId: string; amount: number | null }>,
) => ({ capturedAt, entries });

test("сотрудник есть в Sheerly, но нет в таблице - расхождение, а не ноль", () => {
  const rows = reconcileDeduction(
    side(AT_SHEERLY, [{ employeeId: "anna", amount: 300 }]),
    side(AT_SHEET, []),
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0].employeeId, "anna");
  assert.equal(rows[0].sheerly, 300);
  assert.equal(rows[0].sheet, null);
  assert.equal(rows[0].delta, null);
  assert.equal(rows[0].status, "only_sheerly");
});

test("сотрудник есть в таблице, но нет в Sheerly - тоже не выпадает", () => {
  const rows = reconcileDeduction(
    side(AT_SHEERLY, []),
    side(AT_SHEET, [{ employeeId: "boris", amount: 120.5 }]),
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0].sheerly, null);
  assert.equal(rows[0].sheet, 120.5);
  assert.equal(rows[0].delta, null);
  assert.equal(rows[0].status, "only_sheet");
});

test("неизвестная сумма не подменяется нулём", () => {
  const rows = reconcileDeduction(
    side(AT_SHEERLY, [
      { employeeId: "anna", amount: null },
      { employeeId: "boris", amount: 0 },
    ]),
    side(AT_SHEET, [
      { employeeId: "anna", amount: 300 },
      { employeeId: "boris", amount: null },
    ]),
  );
  const anna = rows.find((r) => r.employeeId === "anna")!;
  const boris = rows.find((r) => r.employeeId === "boris")!;
  assert.equal(anna.sheerly, null);
  assert.equal(anna.sheet, 300);
  assert.equal(anna.delta, null);
  assert.equal(anna.status, "unknown");
  // Настоящий ноль остаётся нулём, неизвестное - неизвестным.
  assert.equal(boris.sheerly, 0);
  assert.equal(boris.sheet, null);
  assert.equal(boris.delta, null);
  assert.equal(boris.status, "unknown");
});

test("совпадение до копейки даёт нулевую дельту", () => {
  const rows = reconcileDeduction(
    side(AT_SHEERLY, [{ employeeId: "anna", amount: 300.1 }]),
    side(AT_SHEET, [{ employeeId: "anna", amount: 300.1 }]),
  );
  assert.equal(rows[0].delta, 0);
  assert.equal(rows[0].status, "match");
});

test("дельта считается в копейках без хвостов float и знак - Sheerly минус таблица", () => {
  const rows = reconcileDeduction(
    side(AT_SHEERLY, [{ employeeId: "anna", amount: 0.3 }, { employeeId: "boris", amount: 100 }]),
    side(AT_SHEET, [{ employeeId: "anna", amount: 0.1 }, { employeeId: "boris", amount: 150.25 }]),
  );
  assert.equal(rows.find((r) => r.employeeId === "anna")!.delta, 0.2);
  assert.equal(rows.find((r) => r.employeeId === "boris")!.delta, -50.25);
  assert.equal(rows.find((r) => r.employeeId === "boris")!.status, "differs");
});

test("отметка момента снятия сохраняется в результате, даже когда стороны пусты", () => {
  const rows = reconcileDeduction(
    side(AT_SHEERLY, [{ employeeId: "anna", amount: 1 }]),
    side(AT_SHEET, [{ employeeId: "boris", amount: 2 }]),
  );
  for (const r of rows) {
    assert.equal(r.sheerlyCapturedAt, AT_SHEERLY);
    assert.equal(r.sheetCapturedAt, AT_SHEET);
  }
});

test("повтор сотрудника на одной стороне суммируется, а с неизвестной суммой делает итог неизвестным", () => {
  const rows = reconcileDeduction(
    side(AT_SHEERLY, [{ employeeId: "anna", amount: 100 }]),
    side(AT_SHEET, [
      { employeeId: "anna", amount: 60 },
      { employeeId: "anna", amount: 40 },
      { employeeId: "boris", amount: 10 },
      { employeeId: "boris", amount: null },
    ]),
  );
  assert.equal(rows.find((r) => r.employeeId === "anna")!.sheet, 100);
  assert.equal(rows.find((r) => r.employeeId === "anna")!.status, "match");
  assert.equal(rows.find((r) => r.employeeId === "boris")!.sheet, null);
});

test("порядок результата не зависит от порядка входа", () => {
  const a = reconcileDeduction(
    side(AT_SHEERLY, [{ employeeId: "b", amount: 1 }, { employeeId: "a", amount: 2 }]),
    side(AT_SHEET, [{ employeeId: "c", amount: 3 }]),
  );
  const b = reconcileDeduction(
    side(AT_SHEERLY, [{ employeeId: "a", amount: 2 }, { employeeId: "b", amount: 1 }]),
    side(AT_SHEET, [{ employeeId: "c", amount: 3 }]),
  );
  assert.deepEqual(a, b);
  assert.deepEqual(a.map((r) => r.employeeId), ["a", "b", "c"]);
});
