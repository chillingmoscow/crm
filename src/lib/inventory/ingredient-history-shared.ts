/**
 * История позиции по актам: раскладка строк и сводка «когда в плюс, когда в минус».
 *
 * Вся логика, кроме самих запросов, живёт здесь — без импортов из `@/...`, чтобы
 * node:test мог импортировать напрямую (тест-раннер не резолвит alias из
 * tsconfig — см. list-documents-shared.ts).
 */

import { hasCountedResults } from "./act-status.ts";
import {
  applyResultSnapshot,
  isInventoryResultFrozen,
  type InventoryResultSnapshotRow,
} from "./results-snapshot.ts";

/** Поля акта, нужные строке истории. */
export type IngredientHistoryDocument = {
  document_number: string;
  invoice_date: string | null;
  status: string;
  results_finalized_at: string | null;
  results_reopened_at: string | null;
  results_snapshot_at: string | null;
};

export type IngredientHistoryItem = InventoryResultSnapshotRow & {
  id: string;
  document_id: string;
  measure_unit_name: string | null;
  exclude_reason: string | null;
  documents: IngredientHistoryDocument | IngredientHistoryDocument[] | null;
};

/** Позиция закрыта пересортом: сколько зачли и что осталось после зачёта. */
export type IngredientHistoryResort = {
  offsetAmount: number;
  remainingDifferenceAmount: number;
  remainingDifferenceSum: number;
};

export type IngredientHistoryEntry = {
  documentId: string;
  documentNumber: string;
  invoiceDate: string | null;
  status: string;
  /** Акт сдан, итоги по нему существуют. Иначе разницы нет — см. ниже. */
  counted: boolean;
  actualAmount: number | null;
  calculatedAmount: number | null;
  measureUnitName: string | null;
  differenceAmount: number | null;
  differenceSum: number | null;
  /** Строка исключена из управленческих итогов (вручную или правилом). */
  excluded: boolean;
  /**
   * Причина исключения. Снимка у неё нет (колонки `finalized_exclude_reason` не
   * существует), а снятие исключения обнуляет поле — поэтому у зафиксированного
   * акта причина может отсутствовать при `excluded = true`. Подпись обязана
   * переживать null.
   */
  excludeReason: string | null;
  resort: IngredientHistoryResort | null;
};

function oneRelation<T>(value: T | T[] | null): T | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

/**
 * Акты, по которым показываем снимок итогов, а не живые значения: итоги
 * залочены и снимок снят (миграции 221/227). Нужны и строкам, и пересортам —
 * иначе в одной картине сойдутся замороженные строки и живые пересорты.
 */
export function frozenDocumentIds(items: readonly IngredientHistoryItem[]): Set<string> {
  const ids = new Set<string>();
  for (const item of items) {
    const doc = oneRelation(item.documents);
    if (doc && isInventoryResultFrozen(doc)) ids.add(item.document_id);
  }
  return ids;
}

/**
 * Строки истории: свежие акты сверху.
 *
 * Разница здесь фактическая — ровно то, что насчитали по строке. Пометки
 * `excluded` и `resort` объясняют, почему она могла не дойти до управленческого
 * итога, но самого числа не меняют.
 *
 * `withResults = false` — у пользователя нет права на итоги: строка отдаёт
 * только «где встречается» (акт, дата, статус), а разница, суммы, исключения и
 * пересорты не приезжают с сервера вовсе.
 */
export function buildIngredientHistory(
  items: readonly IngredientHistoryItem[],
  resortByItemId: ReadonlyMap<string, IngredientHistoryResort>,
  frozenDocIds: ReadonlySet<string>,
  withResults = true,
): IngredientHistoryEntry[] {
  const entries = items.map((item) => {
    const doc = oneRelation(item.documents);
    const status = doc?.status ?? "—";
    // До сдачи акта разницы не существует: Quick Resto считает её как
    // «факт − расчётный остаток» и отдаёт всегда, поэтому у нетронутого акта она
    // равна минус всему складскому остатку (см. hasCountedResults). Отдаём null,
    // чтобы такая строка не читалась как недостача и не попала в сводку.
    const counted = withResults && hasCountedResults(status);
    // Снимок применяем ко ВСЕЙ строке, а не только к разнице: у зафиксированного
    // акта факт и расчёт обязаны быть теми же, из которых эта разница получилась.
    // Иначе Quick Resto пересчитает остатки, живые факт с расчётом уедут, и в
    // одной строке сойдутся утверждённая разница и уже другие слагаемые.
    const resolved = applyResultSnapshot(item, frozenDocIds.has(item.document_id));
    return {
      documentId: item.document_id,
      documentNumber: doc?.document_number ?? "—",
      invoiceDate: doc?.invoice_date ?? null,
      status,
      counted,
      actualAmount: resolved.actual_amount,
      calculatedAmount: resolved.calculated_amount,
      measureUnitName: item.measure_unit_name,
      differenceAmount: counted ? resolved.difference_amount : null,
      differenceSum: counted ? resolved.difference_sum : null,
      excluded: counted ? resolved.excluded_from_totals === true : false,
      excludeReason: counted ? item.exclude_reason : null,
      resort: counted ? (resortByItemId.get(item.id) ?? null) : null,
    };
  });

  // Свежие акты сверху; без даты — в конец, между собой по номеру.
  return entries.sort((a, b) => {
    if (a.invoiceDate && b.invoiceDate && a.invoiceDate !== b.invoiceDate) {
      return a.invoiceDate < b.invoiceDate ? 1 : -1;
    }
    if (a.invoiceDate !== b.invoiceDate) return a.invoiceDate ? -1 : 1;
    return b.documentNumber.localeCompare(a.documentNumber, "ru");
  });
}

export type IngredientHistorySummary = {
  /** Акты с посчитанной разницей: только они попадают в разбивку. */
  countedActs: number;
  /** Акты без итогов — не сданы исполнителем. */
  pendingActs: number;
  /** Акт сдан, но разницы по строке нет: Quick Resto не вернул расчёт. */
  actsWithoutAmounts: number;
  surplusActs: number;
  shortfallActs: number;
  evenActs: number;
  /** Сумма разниц по актам с итогами. */
  netSum: number;
};

/**
 * Классифицируем по КОЛИЧЕСТВУ, а не по сумме: вопрос «когда плюсил, а когда
 * минусил» — про товар. Сумма зависит ещё и от себестоимости, которой у строки
 * может не быть вовсе, и тогда плюс по количеству дал бы ноль по деньгам.
 *
 * «Не сдан» и «сдан, но расчёта нет» — разные вещи, и путать их нельзя: у
 * сданного акта (например `results_blocked`) Quick Resto мог не вернуть
 * построчные расчёты, и назвать такой акт несданным значит соврать.
 */
export function summarizeIngredientHistory(
  rows: readonly Pick<
    IngredientHistoryEntry,
    "counted" | "differenceAmount" | "differenceSum"
  >[],
): IngredientHistorySummary {
  const summary: IngredientHistorySummary = {
    countedActs: 0,
    pendingActs: 0,
    actsWithoutAmounts: 0,
    surplusActs: 0,
    shortfallActs: 0,
    evenActs: 0,
    netSum: 0,
  };

  for (const row of rows) {
    if (!row.counted) {
      summary.pendingActs += 1;
      continue;
    }

    const amount = row.differenceAmount;
    if (typeof amount !== "number" || !Number.isFinite(amount)) {
      summary.actsWithoutAmounts += 1;
      continue;
    }

    summary.countedActs += 1;
    if (amount > 0) summary.surplusActs += 1;
    else if (amount < 0) summary.shortfallActs += 1;
    else summary.evenActs += 1;

    const sum = row.differenceSum;
    if (typeof sum === "number" && Number.isFinite(sum)) summary.netSum += sum;
  }

  return summary;
}
