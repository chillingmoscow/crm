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
  /**
   * Только для снятия: правило, которое побеждает на строке среди оставшихся
   * действующих (без снимаемого), или null. Вызывающий считает его тем же
   * buildExclusionMatcher.
   */
  nextRuleId: string | null;
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
  /**
   * Снятие правила, когда строку по-прежнему покрывает другое действующее
   * правило (например, правило группы над правилом товара): строка остаётся
   * исключённой, меняется только происхождение — на это правило.
   */
  transferTo?: string;
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

/**
 * Снятие правила. Если строку покрывает другое действующее правило
 * (`nextRuleId`), исключение переходит к нему (строка остаётся вне итогов,
 * снимок подведённой строки не меняется, если уже исключён); иначе строка
 * возвращается в итоги. Строку, где проверяющий отказался от правила, не
 * передаём — её решение сильнее любого правила.
 */
export function planRemove(
  ruleId: string,
  lines: RetroLine[],
  lockedDocumentIds: Set<string>,
): RetroPatch[] {
  return lines
    .filter(
      (line) => line.ruleId === ruleId && !lockedDocumentIds.has(line.documentId) && !line.inActiveResort,
    )
    .map((line) =>
      line.nextRuleId != null && line.nextRuleId !== ruleId && line.dismissedAt == null
        ? { ...patchFor(line, true), transferTo: line.nextRuleId }
        : patchFor(line, false),
    );
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
 * Сбой правила ПОСЛЕ того, как часть строк уже записана (сбой следующей пачки,
 * журнала или метки завершения). Несёт акты и месяцы реально записанных строк:
 * их удержание нужно пересчитать, хотя правило не завершено, — при снятии
 * повторный запуск эти строки уже не найдёт (они больше не ссылаются на
 * снимаемое правило).
 */
export class RetroPartialFailure<M extends { venueId: string; month: string }> extends Error {
  readonly documentIds: string[];
  readonly months: M[];
  constructor(message: string, partial: { documentIds: string[]; months: M[] }, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "RetroPartialFailure";
    this.documentIds = partial.documentIds;
    this.months = partial.months;
  }
}

/**
 * Несколько правил подряд: сбой одного не обрывает остальные. Акты и месяцы
 * собираются по успешно завершённым правилам и по уже записанной части
 * упавших (RetroPartialFailure); упавшие возвращаются списком (их метка
 * завершения не ставится — они остаются неприменёнными, и повторный запуск их
 * дочищает). Пересчёт удержания по собранным месяцам — у вызывающего, и он
 * нужен ВСЕГДА, даже если часть правил упала.
 */
export async function runRulesIsolated<M extends { venueId: string; month: string }>(
  ruleIds: string[],
  run: (ruleId: string) => Promise<{ documentIds: string[]; months: M[] }>,
): Promise<{ documentIds: string[]; months: M[]; failures: RetroRuleFailure[] }> {
  const documentIds = new Set<string>();
  const months = new Map<string, M>();
  const failures: RetroRuleFailure[] = [];
  const collect = (r: { documentIds: string[]; months: M[] }) => {
    for (const id of r.documentIds) documentIds.add(id);
    for (const m of r.months) months.set(`${m.venueId}|${m.month}`, m);
  };
  for (const ruleId of new Set(ruleIds)) {
    try {
      collect(await run(ruleId));
    } catch (error) {
      if (error instanceof RetroPartialFailure) collect(error as RetroPartialFailure<M>);
      failures.push({ ruleId, message: error instanceof Error ? error.message : String(error) });
    }
  }
  return { documentIds: [...documentIds], months: [...months.values()], failures };
}

/**
 * Можно ли поставить метку «снятие завершено» (`retro_removed_at`). Нельзя,
 * если строки правила остались в незащищённых актах: в активном пересорте
 * (их нужно дочистить после пересорта) или отсеянные проверкой в самом UPDATE
 * (строка изменилась, пока мы читали, — пусть решит следующая проверка).
 * Строки защищённых актов остаются на правиле намеренно и метке не мешают.
 */
export function removalComplete(
  ruleId: string,
  lines: RetroLine[],
  lockedDocumentIds: Set<string>,
  plannedCount: number,
  writtenCount: number,
): boolean {
  if (writtenCount < plannedCount) return false;
  return !lines.some(
    (line) => line.ruleId === ruleId && line.inActiveResort && !lockedDocumentIds.has(line.documentId),
  );
}

/**
 * Незавершённые удаления: удалённое правило остаётся в работе, пока на него
 * ссылается хоть одна строка незащищённого акта. `lines` — строки, ссылающиеся
 * на удалённые правила, `unprotectedDocumentIds` — акты, которые снятие может
 * менять (инвентаризационные, не архивные, не в защищённом месяце).
 */
export function partitionPendingRemovals(
  ruleIds: string[],
  lines: Array<{ ruleId: string; documentId: string }>,
  unprotectedDocumentIds: Set<string>,
): { pending: string[]; done: string[] } {
  const live = new Set(lines.filter((l) => unprotectedDocumentIds.has(l.documentId)).map((l) => l.ruleId));
  const ids = [...new Set(ruleIds)];
  return { pending: ids.filter((id) => live.has(id)), done: ids.filter((id) => !live.has(id)) };
}
