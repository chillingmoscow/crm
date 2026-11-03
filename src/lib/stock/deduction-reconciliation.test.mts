import { test } from "node:test";
import assert from "node:assert/strict";
import { looksSignFlipped, negateAmounts, reconcileDeduction } from "./deduction-reconciliation.ts";

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

const rowsOf = (pairs: Array<[number | null, number | null]>) =>
  reconcileDeduction(
    side(AT_SHEERLY, pairs.map(([a], i) => ({ employeeId: `e${i}`, amount: a }))),
    side(AT_SHEET, pairs.map(([, b], i) => ({ employeeId: `e${i}`, amount: b }))),
  );

test("знак: все пары равны по модулю и противоположны по знаку - похоже на минус в таблице", () => {
  assert.equal(looksSignFlipped(rowsOf([[300, -300], [150.5, -150.5]])), true);
});

test("знак: пара с нулями с обеих сторон не мешает, но одни нули ничего не доказывают", () => {
  assert.equal(looksSignFlipped(rowsOf([[300, -300], [0, 0]])), true);
  assert.equal(looksSignFlipped(rowsOf([[0, 0]])), false);
});

test("знак: настоящее расхождение или хоть одна пара без переворота - не знак", () => {
  assert.equal(looksSignFlipped(rowsOf([[300, -300], [100, 90]])), false);
  assert.equal(looksSignFlipped(rowsOf([[300, 300]])), false);
  assert.equal(looksSignFlipped(rowsOf([[300, -299]])), false);
});

test("знак: неизвестные суммы и отсутствующие стороны в расчёте не участвуют", () => {
  assert.equal(looksSignFlipped(rowsOf([[300, -300], [null, 50]])), true);
  assert.equal(looksSignFlipped(rowsOf([[null, 50]])), false);
});

test("переворот знака суммы: null остаётся null, ноль остаётся нулём", () => {
  assert.deepEqual(
    negateAmounts([
      { employeeId: "a", amount: -300 },
      { employeeId: "b", amount: null },
      { employeeId: "c", amount: 0 },
    ]).map((e) => e.amount),
    [300, null, 0],
  );
  assert.equal(Object.is(negateAmounts([{ employeeId: "c", amount: 0 }])[0].amount, -0), false);
});
