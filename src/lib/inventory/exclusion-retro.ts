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
 *   - строку в активном пересорте не исключаем (сначала пересорт);
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
};

export type RetroPatch = { id: string; documentId: string; exclude: boolean; finalized: boolean };

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
    // Уже исключена этим правилом — ничего не меняется.
    if (line.excluded && line.ruleId === ruleId) continue;
    // Иначе: строка в итогах или исключена более слабым правилом (например,
    // правилом группы, а теперь появилось правило на сам товар) — происхождение
    // переходит к этому правилу.
    patches.push({ id: line.id, documentId: line.documentId, exclude: true, finalized: line.finalized });
  }
  return patches;
}

export function planRemove(
  ruleId: string,
  lines: RetroLine[],
  lockedDocumentIds: Set<string>,
): RetroPatch[] {
  return lines
    .filter((line) => line.ruleId === ruleId && !lockedDocumentIds.has(line.documentId))
    .map((line) => ({ id: line.id, documentId: line.documentId, exclude: false, finalized: line.finalized }));
}
