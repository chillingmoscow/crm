/**
 * Серверная проверка «заполнены все позиции» перед сдачей акта.
 *
 * Форма не даёт нажать «Завершить», пока есть пустые строки, но это только
 * браузер: прямой вызов экшена (или старая вкладка) сдавал акт с любым
 * непустым подмножеством, и проверяющий получал итоги, где непосчитанные
 * позиции выглядят как полная недостача.
 *
 * Pure, без `@/...` — тестируется node:test напрямую.
 *
 * Какие строки обязательны:
 *  - акт на пересчёте и есть отмеченные строки → только отмеченные, и значение
 *    по ним должно прийти В ЭТОМ запросе: их вернули потому, что прежнему
 *    числу не поверили (форма их и не предзаполняет);
 *  - акт на пересчёте, отметок нет, но есть строки, уже бывавшие на пересчёте
 *    (данные до миграции 228) → они, значение из запроса или сохранённое;
 *  - иначе → все строки акта, значение из запроса или сохранённое ранее
 *    (submitted_amount — форма им же и предзаполняет поле).
 *
 * Каждый вызов пачечной отправки несёт форму целиком, поэтому проверка
 * одинаково отвечает на любом шаге — её делаем до первой записи в Quick Resto.
 */
export type SubmitCompletenessItem = {
  id: string;
  needsRecount: boolean;
  recountPreviousAmount: number | null;
  submittedAmount: number | null;
};

function isFilledAmount(value: number | null | undefined): boolean {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

export function countMissingSubmitItems(input: {
  status: string;
  items: readonly SubmitCompletenessItem[];
  /** itemId → значение из запроса (null — поле пустое). */
  requestAmounts: ReadonlyMap<string, number | null>;
}): number {
  const fromRequest = (id: string) => isFilledAmount(input.requestAmounts.get(id));
  const isRecount = input.status === "recount_pending";

  if (isRecount) {
    const flagged = input.items.filter((item) => item.needsRecount);
    if (flagged.length > 0) {
      return flagged.filter((item) => !fromRequest(item.id)).length;
    }
    const scope = input.items.filter((item) => item.recountPreviousAmount != null);
    if (scope.length > 0) {
      return scope.filter((item) => !fromRequest(item.id) && !isFilledAmount(item.submittedAmount))
        .length;
    }
  }

  return input.items.filter((item) => !fromRequest(item.id) && !isFilledAmount(item.submittedAmount))
    .length;
}
