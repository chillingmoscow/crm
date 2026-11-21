import type { PoolSource } from "./monthly-shortage.ts";
import { writeoffSourcesForMonth } from "./monthly-snapshot.ts";
import type { WriteoffPoolAssignment } from "./writeoff-pools.ts";

/**
 * Состояние удержания по недостаче за месяц глазами страницы «Списания».
 *
 * Последний снимок месяца (`inventory_deduction_snapshots`) хранит источники
 * пулов, по которым поставлены строки ведомости, в том числе акты списания с
 * плательщиком и суммой. Сравнение этих актов с текущим разнесением говорит
 * честно, устарел ли расчёт ИЗ-ЗА СПИСАНИЙ. Остальные входы месяца (акты
 * инвентаризации, смены, правила) здесь не проверяются: их меняют на других
 * экранах, и пересчитать их можно только полным построением месяца.
 *
 * Без импортов из `@/...`: тест-раннер не резолвит alias из tsconfig.
 */

/** То, что страница читает о последнем снимке месяца. */
export type PostedWriteoffDeduction = {
  capturedAt: string;
  /** Сторно без замены (переоткрыли акт инвентаризации): месяц снова не посчитан. */
  reversedAt: string | null;
  /** `snapshot.sources` как есть: проверяется здесь, а не доверяется. */
  sources: unknown;
};

export type WriteoffDeductionStatus =
  | { state: "not_posted"; reversedAt: string | null }
  | { state: "posted"; capturedAt: string }
  /**
   * Разнесение или суммы актов списания разошлись с тем, что посчитано.
   * `unresolved` - сколько актов месяца сейчас без плательщика: пока они есть,
   * пересчёт месяц не поставит.
   */
  | { state: "stale"; capturedAt: string; unresolved: number };

const WRITEOFF_REF = "writeoff:";

const cents = (n: number) => Math.round(n * 100);

/** Отпечаток источника списания: акт, пул, плательщик, сумма в копейках. */
function fingerprint(s: { sourceRef: string; pool: string; key: string | null; amount: number }) {
  return `${s.sourceRef}|${s.pool}|${s.key ?? ""}|${cents(s.amount)}`;
}

/** Источники списаний из сохранённого снимка; битые записи - `null` (сравнить нельзя). */
function postedWriteoffPrints(raw: unknown): string[] | null {
  if (!Array.isArray(raw)) return null;
  const out: string[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") return null;
    const s = item as Record<string, unknown>;
    if (typeof s.sourceRef !== "string") return null;
    if (!s.sourceRef.startsWith(WRITEOFF_REF)) continue;
    if (typeof s.pool !== "string" || typeof s.amount !== "number" || !Number.isFinite(s.amount)) return null;
    if (s.key !== null && s.key !== undefined && typeof s.key !== "string") return null;
    out.push(fingerprint({ sourceRef: s.sourceRef, pool: s.pool, key: (s.key as string | null | undefined) ?? null, amount: s.amount }));
  }
  return out.sort();
}

/**
 * Статус месяца: не посчитан / посчитан / устарел по списаниям.
 * `current` - источники и неразнесённые акты месяца сейчас (`currentWriteoffSources`).
 */
export function writeoffDeductionStatus(
  posted: PostedWriteoffDeduction | null,
  current: { sources: PoolSource[]; unresolved: string[] },
): WriteoffDeductionStatus {
  if (!posted) return { state: "not_posted", reversedAt: null };
  if (posted.reversedAt) return { state: "not_posted", reversedAt: posted.reversedAt };
  const unresolved = current.unresolved.filter((r) => r.startsWith(WRITEOFF_REF)).length;
  const was = postedWriteoffPrints(posted.sources);
  const now = current.sources
    .filter((s) => s.sourceRef.startsWith(WRITEOFF_REF))
    .map(fingerprint)
    .sort();
  const same = was !== null && was.length === now.length && was.every((p, i) => p === now[i]);
  if (same && unresolved === 0) return { state: "posted", capturedAt: posted.capturedAt };
  return { state: "stale", capturedAt: posted.capturedAt, unresolved };
}

/**
 * Источники списаний месяца по данным страницы - тем же расчётом, что и снимок
 * месяца (`writeoffSourcesForMonth`), чтобы сравнение не расходилось с ним.
 * `departments` - подразделения из подписей страницы: пометка на подразделение,
 * которого нет среди них или которое в архиве, расчётом не принимается.
 */
export function currentWriteoffSources(input: {
  venueId: string;
  /** Первое число месяца, `YYYY-MM-01`. */
  month: string;
  documents: Array<{
    venue_id: string;
    external_id: number;
    business_date: string;
    missing_at: string | null;
    payload: unknown;
  }>;
  assignments: WriteoffPoolAssignment[];
  departments: Array<{ id: string; archived: boolean }>;
}): { sources: PoolSource[]; unresolved: string[] } {
  return writeoffSourcesForMonth({
    venueId: input.venueId,
    month: input.month,
    docs: input.documents,
    assignments: input.assignments.map((a) => ({
      venue_id: a.venue_id,
      external_id: a.external_id,
      pool: a.pool,
      department_id: a.pool === "department" ? a.key : null,
      employee_id: a.pool === "personal" ? a.key : null,
    })),
    departments: input.departments.map((d) => ({
      id: d.id,
      venue_id: input.venueId,
      archived_at: d.archived ? "archived" : null,
    })),
  });
}
