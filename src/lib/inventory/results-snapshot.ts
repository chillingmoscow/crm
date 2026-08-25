// Снимок построчных итогов акта (миграция 221).
//
// «Расчёт» и «Разница» в итогах приходят из Quick Resto (amountAtStore / delta /
// differenceCost), а QR пересчитывает их по движениям товара — то же поле,
// прочитанное на день позже, даёт другое число. Поэтому при подведении итогов мы
// снимаем снимок строк (finalized_*) и дальше показываем именно его: то, что
// утвердил проверяющий, не должно меняться задним числом.

export type InventoryResultLiveAmounts = {
  actual_amount: number | null;
  calculated_amount: number | null;
  difference_amount: number | null;
  difference_sum: number | null;
  prime_cost: number | null;
};

export type InventoryResultSnapshotAmounts = {
  finalized_actual_amount?: number | null;
  finalized_calculated_amount?: number | null;
  finalized_difference_amount?: number | null;
  finalized_difference_sum?: number | null;
  finalized_prime_cost?: number | null;
};

export type InventoryResultSnapshotRow = InventoryResultLiveAmounts & InventoryResultSnapshotAmounts;

/**
 * Есть ли у строки снимок. Строка, добавленная в акт уже ПОСЛЕ снятия снимка,
 * снимка не имеет — для неё показываем живые значения (замораживать нечего).
 */
export function hasResultSnapshot(row: InventoryResultSnapshotAmounts): boolean {
  return (
    row.finalized_actual_amount != null ||
    row.finalized_calculated_amount != null ||
    row.finalized_difference_amount != null ||
    row.finalized_difference_sum != null ||
    row.finalized_prime_cost != null
  );
}

/**
 * Подменяет живые значения строки замороженными, если снимок снят.
 *
 * `documentFrozen` — снимок снят на уровне акта (documents.results_snapshot_at).
 * Значения берём из снимка ЦЕЛИКОМ (включая null-поля), а не по-полю через `??`:
 * иначе поле, которое на момент фиксации было пустым, позже подтянуло бы живое
 * значение из QR — ровно та подмена, от которой снимок и защищает.
 */
export function applyResultSnapshot<T extends InventoryResultSnapshotRow>(
  row: T,
  documentFrozen: boolean,
): T & { results_frozen: boolean } {
  if (!documentFrozen || !hasResultSnapshot(row)) {
    return { ...row, results_frozen: false };
  }

  return {
    ...row,
    actual_amount: row.finalized_actual_amount ?? null,
    calculated_amount: row.finalized_calculated_amount ?? null,
    difference_amount: row.finalized_difference_amount ?? null,
    difference_sum: row.finalized_difference_sum ?? null,
    prime_cost: row.finalized_prime_cost ?? null,
    results_frozen: true,
  };
}
