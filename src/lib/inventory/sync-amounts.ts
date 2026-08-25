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
