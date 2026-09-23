// Количества, введённые исполнителем в CRM (document_items.submitted_amount).
//
// Историю правки см. в syncDocumentItems: импорт позиций из Quick Resto писал
// submitted_amount = null всем строкам, по которым в текущем вызове значения не
// передали. Полная синхронизация подстраховывалась, передавая уже сохранённые
// значения, а «Обновить итоги из Quick Resto» — нет, и стирала введённые
// количества по всему акту (прод: СВ340, 300 строк).

/**
 * Что писать в submitted_amount для строки акта.
 *
 * - ключ есть в `submittedAmounts` → это явное значение текущего вызова
 *   (в том числе явный сброс в null);
 * - ключа нет → сохраняем то, что уже введено. Импорт из QR не должен стирать
 *   работу исполнителя.
 */
export function resolveSubmittedAmount(input: {
  externalItemId: string;
  submittedAmounts?: Map<string, number | null>;
  existingAmount?: number | null;
}): number | null {
  if (input.submittedAmounts?.has(input.externalItemId)) {
    return input.submittedAmounts.get(input.externalItemId) ?? null;
  }
  return input.existingAmount ?? null;
}

/** Построчные расчётные значения акта (то, что отдаёт Quick Resto). */
export type InventoryLineResultValues = {
  calculatedAmount: number | null;
  differenceAmount: number | null;
  primeCost: number | null;
  differenceSum: number | null;
};

/**
 * Какие расчётные значения писать в строку акта.
 *
 * Quick Resto отдаёт расчётный остаток и разницу только через backoffice. Если
 * backoffice не ответил (таймаут, слетевшая cookie, пустой ответ), импорт
 * сваливается на public-payload, где этих полей нет вообще — и раньше писал
 * NULL поверх уже посчитанных итогов: таблица итогов пропадала, авто-флаги
 * пересчёта гасли, а восстановить прежние числа было нечем.
 *
 * Правило: пустой ответ ничего не значит. Затираем существующие значения
 * только тогда, когда пришли новые.
 */
export function resolveLineResult(input: {
  incoming: InventoryLineResultValues & { hasResult: boolean };
  existing?: Partial<InventoryLineResultValues> | null;
}): { values: InventoryLineResultValues; preserved: boolean } {
  const { hasResult, ...incoming } = input.incoming;
  if (hasResult) return { values: incoming, preserved: false };

  const existing = input.existing;
  const hasExisting =
    existing != null &&
    (existing.calculatedAmount != null ||
      existing.differenceAmount != null ||
      existing.differenceSum != null ||
      existing.primeCost != null);
  if (!hasExisting) return { values: incoming, preserved: false };

  return {
    values: {
      calculatedAmount: existing.calculatedAmount ?? null,
      differenceAmount: existing.differenceAmount ?? null,
      primeCost: existing.primeCost ?? null,
      differenceSum: existing.differenceSum ?? null,
    },
    preserved: true,
  };
}
