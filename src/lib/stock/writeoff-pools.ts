import type { PoolKind, PoolSource } from "./monthly-shortage.ts";
import type { WriteoffKind } from "./writeoffs.ts";

/** Только то, что нужно сборке: подходит и для строки зеркала `StoredWriteoff`. */
export type WriteoffPoolDoc = {
  /** `external_id` уникален только внутри заведения, поэтому заведение — часть ключа. */
  venue_id: string;
  external_id: number;
  missing_at: string | null;
  payload: {
    processed: boolean;
    kind: WriteoffKind;
    lines: Array<{ id: number; amount: number | null }>;
  };
};
/**
 * Пометка человека: кто платит за акт. Живёт отдельно от зеркала актов.
 * "excluded" — осознанное «не удерживать» (например, личное потребление, которое
 * сотрудник оплачивает сам): записанное решение, но не пул и не источник.
 */
export type WriteoffPoolAssignment = {
  venue_id: string;
  external_id: number;
  pool: PoolKind | "excluded";
  /** Подразделение для "department", сотрудник для "personal", иначе null. */
  key: string | null;
};

/** Ключ акта и его пометки: заведение + внешний ID (один ID бывает в разных заведениях). */
export const writeoffPoolKey = (venueId: string, externalId: number) =>
  `${venueId}:${externalId}`;

/** Устойчивый ID источника для `PoolSource.sourceRef` и `unresolved`. */
export const writeoffSourceRef = (venueId: string, externalId: number) =>
  `writeoff:${writeoffPoolKey(venueId, externalId)}`;

/**
 * В расчёт идут только проведённые акты, которые ещё есть в источнике. Одно и то
 * же условие решает и что считать, и что журнал требует разнести: «Не разнесён»
 * на экране и `unresolved` в расчёте не могут разойтись.
 */
export const writeoffCounts = (d: Pick<WriteoffPoolDoc, "missing_at"> & {
  payload: Pick<WriteoffPoolDoc["payload"], "processed">;
}) => !d.missing_at && d.payload.processed;

/**
 * Личное потребление — до ближайшего рубля, всё остальное — вверх. Правило
 * привязано к виду акта из источника, а не к выбранному пулу: так его применял
 * прежний автомат, и владелец решил это сохранить.
 *
 * Совпадает с `legacyAmount` из синхронизации для видов personal, employee, team
 * и masters. Для business и unknown `legacyAmount` пуст (прежний автомат их не
 * считал), а здесь они, раз их разнёс человек, считаются вверх.
 */
const roundLine = (kind: WriteoffKind, amount: number) =>
  kind === "personal" ? Math.round(amount) : Math.ceil(amount);

/**
 * Сумма акта в рублях к разнесению: округление по каждой позиции, не по сумме.
 * `null`, если у какой-то позиции сумма неизвестна или отрицательна: такой акт
 * нельзя молча посчитать как ноль.
 */
export function writeoffChargeRubles(
  kind: WriteoffKind,
  lines: Array<{ amount: number | null }>,
): number | null {
  if (
    lines.length === 0 ||
    lines.some(
      (l) => l.amount === null || !Number.isFinite(l.amount) || l.amount < 0,
    )
  )
    return null;
  return lines.reduce((s, l) => s + roundLine(kind, l.amount!), 0);
}

const ownMark = (
  doc: Pick<WriteoffPoolDoc, "venue_id" | "external_id">,
  m: WriteoffPoolAssignment | undefined,
) =>
  m && m.venue_id === doc.venue_id && m.external_id === doc.external_id
    ? m
    : undefined;

const validMark = (m: WriteoffPoolAssignment | undefined) =>
  !!m &&
  (m.pool === "shared" || m.pool === "excluded"
    ? !m.key
    : (m.pool === "department" || m.pool === "personal") && !!m.key);

/**
 * Состояние разнесения акта для журнала.
 * - "unassigned": нужен выбор человека, пока его нет месяц неполный;
 * - "not_needed": акт на ноль рублей, ничего не меняет в пулах и месяц не блокирует;
 * - "not_counted": черновик или пропавший акт без пометки, в расчёт не идёт.
 */
export function writeoffPoolState(
  doc: WriteoffPoolDoc,
  assignment: WriteoffPoolAssignment | undefined,
): "assigned" | "unassigned" | "not_needed" | "not_counted" {
  // Чужая пометка (другое заведение или другой акт) — не пометка этого акта.
  const mark = ownMark(doc, assignment);
  if (!writeoffCounts(doc)) return validMark(mark) ? "assigned" : "not_counted";
  if (validMark(mark)) return "assigned";
  return writeoffChargeRubles(doc.payload.kind, doc.payload.lines) === 0
    ? "not_needed"
    : "unassigned";
}

/** Подпись плательщика для журнала. Имена приходят отдельно: пометка хранит только ID. */
export function writeoffPoolLabel(
  mark: WriteoffPoolAssignment,
  names: { departments: Map<string, string>; employees: Map<string, string> },
): string {
  if (mark.pool === "shared") return "Вся команда";
  if (mark.pool === "excluded") return "Не удерживать";
  if (mark.pool === "department")
    return `Подразделение: ${names.departments.get(mark.key ?? "") ?? "не найдено"}`;
  return `Сотрудник: ${names.employees.get(mark.key ?? "") ?? "не найден"}`;
}

/**
 * Акты списаний -> источники пулов месячного сальдо. Пул выбирает человек;
 * вид акта и причина списания пул не подсказывают и расчёт не фильтруют.
 *
 * Акт без пометки (или с неполной пометкой, или с неизвестной суммой) попадает
 * в `unresolved` и ни в какой пул не идёт: молчаливый «общий пул» по умолчанию
 * списал бы на всю команду то, что никто не разнёс.
 */
export function writeoffPoolSources(
  docs: WriteoffPoolDoc[],
  assignments: WriteoffPoolAssignment[],
): { sources: PoolSource[]; unresolved: string[] } {
  const marks = new Map<string, WriteoffPoolAssignment>();
  for (const a of assignments)
    marks.set(writeoffPoolKey(a.venue_id, a.external_id), a);

  const sources: PoolSource[] = [];
  const unresolved: string[] = [];
  for (const d of docs) {
    if (!writeoffCounts(d)) continue;
    const sourceRef = writeoffSourceRef(d.venue_id, d.external_id);
    const mark = marks.get(writeoffPoolKey(d.venue_id, d.external_id));
    // Явное «не удерживать»: решение человека, а не пробел. Источника нет, месяц не блокируется.
    if (mark?.pool === "excluded" && validMark(mark)) continue;
    const rubles = writeoffChargeRubles(d.payload.kind, d.payload.lines);
    // Акт на ноль рублей не меняет ни один пул: разносить его не обязательно.
    if (rubles === 0) continue;
    if (!mark || !validMark(mark) || rubles === null) {
      unresolved.push(sourceRef);
      continue;
    }
    sources.push({
      // "excluded" отсёк выше: здесь остаются только настоящие пулы.
      pool: mark.pool as PoolKind,
      key: mark.key ? mark.key : null,
      // Списание — потеря: недостача отрицательна.
      amount: -rubles,
      sourceRef,
    });
  }
  return { sources, unresolved };
}
