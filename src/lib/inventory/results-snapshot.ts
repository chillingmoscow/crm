// Снимок построчных итогов акта (миграция 221).
//
// «Расчёт» и «Разница» в итогах приходят из Quick Resto (amountAtStore / delta /
// differenceCost), а QR пересчитывает их по движениям товара — то же поле,
// прочитанное на день позже, даёт другое число. Поэтому при подведении итогов мы
// снимаем снимок строк (finalized_*) и дальше показываем именно его: то, что
// утвердил проверяющий, не должно меняться задним числом.

import { isInventoryResultLocked, type InventoryActLockInput } from "./act-status.ts";

export type InventoryResultLiveAmounts = {
  actual_amount: number | null;
  calculated_amount: number | null;
  difference_amount: number | null;
  difference_sum: number | null;
  prime_cost: number | null;
  excluded_from_totals?: boolean | null;
};

export type InventoryResultSnapshotAmounts = {
  /** Маркер «со строки снят снимок» (миграция 221). */
  finalized_at?: string | null;
  finalized_actual_amount?: number | null;
  finalized_calculated_amount?: number | null;
  finalized_difference_amount?: number | null;
  finalized_difference_sum?: number | null;
  finalized_prime_cost?: number | null;
  finalized_excluded_from_totals?: boolean | null;
};

export type InventoryResultSnapshotRow = InventoryResultLiveAmounts & InventoryResultSnapshotAmounts;

/**
 * Есть ли у строки снимок. Строка, добавленная в акт уже ПОСЛЕ снятия снимка,
 * снимка не имеет — для неё показываем живые значения (замораживать нечего).
 *
 * Смотрим на явный маркер `finalized_at`, а не на сами значения: строка, у
 * которой на момент фиксации все поля были пустыми (QR не вернул построчные
 * расчёты), по значениям неотличима от строки, добавленной позже, — и показала
 * бы живые числа вместо утверждённых пустых.
 */
export function hasResultSnapshot(row: InventoryResultSnapshotAmounts): boolean {
  return row.finalized_at != null;
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
    // Исключение строки из итогов — часть управленческого итога, поэтому тоже
    // в снимке: правило автоисключения могло появиться или исчезнуть после
    // того, как итоги утвердили (миграция 227).
    excluded_from_totals: row.finalized_excluded_from_totals ?? false,
    results_frozen: true,
  };
}

/**
 * Минимум полей строки, из которых складывается управленческий итог: разница и
 * признак исключения. Отдельный хелпер нужен списку актов — там не читают факт,
 * расчёт и себестоимость, а тянуть их ради applyResultSnapshot было бы лишним
 * трафиком на 7 500 строках.
 */
export type InventoryResultLineTotalsRow = {
  difference_amount: number | null;
  difference_sum: number | null;
  excluded_from_totals: boolean | null;
  finalized_at?: string | null;
  finalized_difference_amount?: number | null;
  finalized_difference_sum?: number | null;
  finalized_excluded_from_totals?: boolean | null;
};

/** Разница и исключение строки: из снимка, если он снят. См. applyResultSnapshot. */
export function resultLineTotals(row: InventoryResultLineTotalsRow, documentFrozen: boolean) {
  if (documentFrozen && hasResultSnapshot(row)) {
    return {
      differenceAmount: row.finalized_difference_amount ?? null,
      differenceSum: row.finalized_difference_sum ?? null,
      excluded: row.finalized_excluded_from_totals ?? false,
    };
  }
  return {
    differenceAmount: row.difference_amount,
    differenceSum: row.difference_sum,
    excluded: row.excluded_from_totals,
  };
}

/**
 * Показываем ли по акту снимок итогов, а не живые значения.
 *
 * Два условия вместе: итоги залочены (финализированы или акт проведён и не
 * переоткрыт) И снимок реально снят. После переоткрытия итогов снова показываем
 * живые значения — проверяющий сознательно вернулся к правке.
 */
export function isInventoryResultFrozen(
  doc: InventoryActLockInput & { results_snapshot_at: string | null },
): boolean {
  return isInventoryResultLocked(doc) && doc.results_snapshot_at != null;
}

// ── Пересорты ───────────────────────────────────────────────
// Управленческий итог складывается не только из строк: пересорт меняет и
// зачтённый объём, и корректировку себестоимости. Пересорты пересчитываются
// при каждом импорте, поэтому у зафиксированного акта они тоже должны браться
// из снимка — иначе в одном итоге сходятся две разные даты (миграция 227).

export type InventoryResortSnapshotRow = {
  status: string;
  offset_amount: number | null;
  residual_shortfall_sum: number | null;
  residual_surplus_sum: number | null;
  cost_adjustment_sum: number | null;
  finalized_at?: string | null;
  finalized_status?: string | null;
  finalized_offset_amount?: number | null;
  finalized_residual_shortfall_sum?: number | null;
  finalized_residual_surplus_sum?: number | null;
  finalized_cost_adjustment_sum?: number | null;
};

export type InventoryResortItemSnapshotRow = {
  source_difference_amount: number | null;
  source_difference_sum: number | null;
  offset_amount: number | null;
  remaining_difference_amount: number | null;
  remaining_difference_sum: number | null;
  finalized_at?: string | null;
  finalized_source_difference_amount?: number | null;
  finalized_source_difference_sum?: number | null;
  finalized_offset_amount?: number | null;
  finalized_remaining_difference_amount?: number | null;
  finalized_remaining_difference_sum?: number | null;
};

/**
 * Пересорт по снимку: и суммы, и СТАТУС. Статус важен не меньше сумм — пересорт,
 * аннулированный после фиксации (например триггером, когда строка акта
 * исчезла), не должен задним числом пропадать из утверждённого итога.
 * Пересорт, созданный уже после снимка, снимка не имеет — он в итог
 * зафиксированного акта и не входит (finalized_status = null → не активен).
 */
export function applyResortSnapshot<T extends InventoryResortSnapshotRow>(
  row: T,
  documentFrozen: boolean,
): T {
  if (!documentFrozen || row.finalized_at == null) return row;
  return {
    ...row,
    status: row.finalized_status ?? "voided",
    offset_amount: row.finalized_offset_amount ?? null,
    residual_shortfall_sum: row.finalized_residual_shortfall_sum ?? null,
    residual_surplus_sum: row.finalized_residual_surplus_sum ?? null,
    cost_adjustment_sum: row.finalized_cost_adjustment_sum ?? null,
  };
}

/** Позиция пересорта по снимку. См. applyResortSnapshot. */
export function applyResortItemSnapshot<T extends InventoryResortItemSnapshotRow>(
  row: T,
  documentFrozen: boolean,
): T {
  if (!documentFrozen || row.finalized_at == null) return row;
  return {
    ...row,
    source_difference_amount: row.finalized_source_difference_amount ?? null,
    source_difference_sum: row.finalized_source_difference_sum ?? null,
    offset_amount: row.finalized_offset_amount ?? null,
    remaining_difference_amount: row.finalized_remaining_difference_amount ?? null,
    remaining_difference_sum: row.finalized_remaining_difference_sum ?? null,
  };
}
