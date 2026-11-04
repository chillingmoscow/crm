/**
 * Ретроактивное применение и снятие правила исключения на строках уже
 * существующих актов (в том числе подведённых).
 *
 * Правило «Исключать всегда» действует на позицию во всех актах аккаунта, но
 * импорт применяет его только к актам, которые синхронизируются после создания
 * правила. Здесь решается, какие строки старых актов правило меняет сразу:
 *
 *   - акты зафиксированных месяцев (зарплатный период не черновик) не трогаем;
 *   - решения человека сильнее правила: строку, исключённую вручную, и строку,
 *     на которой проверяющий отказался от правила
 *     (`exclusion_rule_dismissed_at`), правило не перезаписывает;
 *   - строку в активном пересорте не трогаем ни при применении, ни при снятии
 *     (сначала пересорт);
 *   - у подведённой строки меняется и снимок `finalized_excluded_from_totals`.
 *
 * Что строка подпадает именно под ЭТО правило (а не под более сильное другое),
 * решает вызывающий код через buildExclusionMatcher — сюда приходят уже
 * отобранные строки.
 *
 * Без импортов из `@/...`, чтобы node:test мог импортировать файл напрямую.
 */

export type RetroLine = {
  id: string;
  documentId: string;
  excluded: boolean;
  ruleId: string | null;
  dismissedAt: string | null;
  inActiveResort: boolean;
  finalized: boolean;
  /** Текущее значение утверждённого снимка (`finalized_excluded_from_totals`). */
  finalizedExcluded: boolean | null;
};

/**
 * `snapshotChanged` — меняется ли утверждённый снимок подведённой строки: только
 * такие изменения влияют на удержание и требуют пересчёта месяца.
 */
export type RetroPatch = {
  id: string;
  documentId: string;
  exclude: boolean;
  finalized: boolean;
  snapshotChanged: boolean;
};

function patchFor(line: RetroLine, exclude: boolean): RetroPatch {
  return {
    id: line.id,
    documentId: line.documentId,
    exclude,
    finalized: line.finalized,
    snapshotChanged: line.finalized && line.finalizedExcluded !== exclude,
  };
}

export function planApply(
  ruleId: string,
  lines: RetroLine[],
  lockedDocumentIds: Set<string>,
): RetroPatch[] {
  const patches: RetroPatch[] = [];
  for (const line of lines) {
    if (lockedDocumentIds.has(line.documentId)) continue;
    if (line.dismissedAt != null) continue;
    if (line.inActiveResort) continue;
    // Исключена вручную — за строку отвечает человек.
    if (line.excluded && line.ruleId == null) continue;
    // Уже исключена этим правилом (и в снимке, если строка подведена) —
    // ничего не меняется.
    if (line.excluded && line.ruleId === ruleId && (!line.finalized || line.finalizedExcluded === true)) continue;
    // Иначе: строка в итогах, исключена более слабым правилом (например,
    // правилом группы, а теперь появилось правило на сам товар) — происхождение
    // переходит к этому правилу, — или снимок подведённой строки отстал.
    patches.push(patchFor(line, true));
  }
  return patches;
}

export function planRemove(
  ruleId: string,
  lines: RetroLine[],
  lockedDocumentIds: Set<string>,
): RetroPatch[] {
  return lines
    .filter(
      (line) => line.ruleId === ruleId && !lockedDocumentIds.has(line.documentId) && !line.inActiveResort,
    )
    .map((line) => patchFor(line, false));
}

/**
 * Подведённые строки незафиксированных актов, где правило уже действует и в
 * снимке. Если прошлое применение оборвалось (нет `metadata.retro_applied_at`),
 * часть строк могла быть записана без пересчёта удержания — их месяцы нужно
 * пересчитать, хотя patch по ним уже не нужен.
 */
export function settledFinalizedLines(
  ruleId: string,
  lines: RetroLine[],
  lockedDocumentIds: Set<string>,
): RetroLine[] {
  return lines.filter(
    (line) =>
      line.ruleId === ruleId &&
      line.excluded &&
      line.finalized &&
      line.finalizedExcluded === true &&
      !lockedDocumentIds.has(line.documentId),
  );
}
