// Чистые правила разовой загрузки проведённых актов склада из Quick Resto
// (акты взвешивания табака, которые до Sheerly вёл n8n). Без сети и базы —
// тестируется node:test. Сеть и запись — в /dev/import-store-acts/actions.ts.

export type ImportSkipReason =
  | "не проведён"
  | "удалён"
  | "раньше даты"
  | "уже в Sheerly"
  | "другие позиции"
  | "склад не указан";

export type ImportDecision = { import: true } | { import: false; reason: ImportSkipReason };

/**
 * Загружать ли акт Quick Resto.
 *
 * Загружаем только проведённый живой акт с датой не раньше `from`, которого
 * Sheerly ещё не знает, и в котором нет ничего, кроме разрешённых позиций
 * (табак: «Стандарт», «Премиум», «Парфюм»). Акт без позиций загружать нечем.
 *
 * `invoiceDate` — день акта `YYYY-MM-DD` (в часовом поясе заведения; лишняя
 * часть строки после даты не учитывается), `from` — `YYYY-MM-DD`.
 *
 * `storeExternalId` — склад загрузки: акт без склада (или с другим) не
 * загружается, иначе его недостача легла бы на чужое заведение. Склад
 * проверяется последним — так решение без позиций (по списку актов) доходит
 * до «другие позиции» и говорит, что акт пора прочитать целиком.
 */
export function classifyImportCandidate(
  doc: {
    processed: boolean;
    deleted: boolean;
    invoiceDate: string;
    productIds: number[];
    /** Склад акта в Quick Resto; null — не указан. */
    storeId?: number | null;
  },
  opts: {
    from: string;
    allowedProductIds: number[];
    knownExternalIds: Set<number>;
    externalId: number;
    storeExternalId?: number;
  },
): ImportDecision {
  if (doc.deleted) return { import: false, reason: "удалён" };
  if (doc.invoiceDate.slice(0, 10) < opts.from) return { import: false, reason: "раньше даты" };
  if (!doc.processed) return { import: false, reason: "не проведён" };
  if (opts.knownExternalIds.has(opts.externalId)) return { import: false, reason: "уже в Sheerly" };
  const allowed = new Set(opts.allowedProductIds);
  if (doc.productIds.length === 0 || doc.productIds.some((id) => !allowed.has(id))) {
    return { import: false, reason: "другие позиции" };
  }
  if (opts.storeExternalId !== undefined && doc.storeId !== opts.storeExternalId) {
    return { import: false, reason: "склад не указан" };
  }
  return { import: true };
}

/** Месяцы `YYYY-MM`, которых касаются загруженные акты, по порядку. */
export function affectedMonths(dates: string[]): string[] {
  return [...new Set(dates.map((date) => date.slice(0, 7)))].sort();
}

/** Номера позиций Quick Resto из поля ввода: «417, 420 1892». */
export function parseProductIds(raw: string): { ids: number[] } | { error: string } {
  const parts = raw.split(/[\s,;]+/).filter(Boolean);
  if (parts.length === 0) return { error: "Укажите номера позиций Quick Resto" };
  if (parts.some((part) => !/^\d{1,12}$/.test(part))) {
    return { error: "Номера позиций — целые числа через запятую" };
  }
  return { ids: [...new Set(parts.map(Number))] };
}

/** День `YYYY-MM-DD` момента времени в часовом поясе заведения. */
export function dayInZone(ms: number, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(ms));
}

/**
 * Акт уже есть в Sheerly, но загрузка не довела его до конца: проведён, а
 * итоги не зафиксированы и не переоткрывались. Такой акт повторный запуск
 * дозагружает, а не пропускает как «уже в Sheerly» — иначе после сбоя
 * посередине он навсегда остался бы без снимка итогов. Переоткрытый акт
 * (results_reopened_at) — решение человека, его не трогаем.
 */
export function isResumableImport(row: {
  status: string;
  results_finalized_at: string | null;
  results_reopened_at: string | null;
  results_snapshot_at: string | null;
  archived_at: string | null;
}): boolean {
  return (
    row.status === "processed" &&
    !row.results_finalized_at &&
    !row.results_reopened_at &&
    !row.results_snapshot_at &&
    !row.archived_at
  );
}
