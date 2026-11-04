/**
 * Ретроактивное применение и снятие правила исключения на строках уже
 * существующих актов (в том числе подведённых).
 *
 * Правило «Исключать всегда» действует на позицию во всех актах аккаунта, но
 * импорт применяет его только к актам, которые синхронизируются после создания
 * правила. Здесь решается, какие строки старых актов правило меняет сразу:
 *
 *   - акты защищённых месяцев не трогаем: зафиксированных в зарплате
 *     (период не черновик) и более ранних, чем дата заведения «Исключения
 *     меняют акты начиная с» (isProtectedMonth). Акт без заведения или без
 *     даты тоже защищён: границу для него не проверить. Набор таких актов
 *     собирает вызывающий код и передаёт как `lockedDocumentIds`;
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

/**
 * Месяц акта (YYYY-MM-01) раньше границы заведения «Исключения меняют акты
 * начиная с» (дата, берётся её месяц). Без границы (null) защиты нет.
 */
export function isProtectedMonth(month: string, boundary: string | null): boolean {
  if (!boundary) return false;
  return month.slice(0, 7) < boundary.slice(0, 7);
}

export type RetroRuleFailure = { ruleId: string; message: string };

/**
 * Несколько правил подряд: сбой одного не обрывает остальные. Акты и месяцы
 * собираются только по успешно завершённым правилам; упавшие возвращаются
 * списком (их метка завершения не ставится — они остаются неприменёнными, и
 * повторный запуск их дочищает). Пересчёт удержания по собранным месяцам —
 * у вызывающего, и он нужен ВСЕГДА, даже если часть правил упала: подведённые
 * акты, изменённые успешными правилами, иначе остались бы без пересчёта.
 */
export async function runRulesIsolated<M extends { venueId: string; month: string }>(
  ruleIds: string[],
  run: (ruleId: string) => Promise<{ documentIds: string[]; months: M[] }>,
): Promise<{ documentIds: string[]; months: M[]; failures: RetroRuleFailure[] }> {
  const documentIds = new Set<string>();
  const months = new Map<string, M>();
  const failures: RetroRuleFailure[] = [];
  for (const ruleId of new Set(ruleIds)) {
    try {
      const r = await run(ruleId);
      for (const id of r.documentIds) documentIds.add(id);
      for (const m of r.months) months.set(`${m.venueId}|${m.month}`, m);
    } catch (error) {
      failures.push({ ruleId, message: error instanceof Error ? error.message : String(error) });
    }
  }
  return { documentIds: [...documentIds], months: [...months.values()], failures };
}
