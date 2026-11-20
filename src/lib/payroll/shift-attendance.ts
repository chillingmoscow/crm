import type { ShiftAttendanceMark } from "./types";

export type ShiftReviewDecision = "include" | "exclude";

/** Отметка смены после решения управляющего: «зачтена» или «не учтена». */
export function reviewedMark(
  mark: ShiftAttendanceMark,
  decision: ShiftReviewDecision,
  reason: string,
): ShiftAttendanceMark {
  return { ...mark, state: decision === "include" ? "included" : "excluded", reason };
}

/**
 * Решение по смене сохраняется сразу, а отметки дня пересчитываются позже.
 * Пока пересчёт не дошёл (решение новее синхронизации дня), показываем
 * решение — иначе значок «!» висел бы на уже зачтённой смене.
 */
export function applyShiftReviews(
  marks: Record<string, ShiftAttendanceMark>,
  reviews: { shift_id: string; decision: ShiftReviewDecision | null; reason: string; reviewed_at: string }[],
): Record<string, ShiftAttendanceMark> {
  const result = { ...marks };
  for (const review of reviews) {
    const mark = result[review.shift_id];
    if (!mark || !review.decision) continue;
    if (mark.syncedAt && Date.parse(review.reviewed_at) <= Date.parse(mark.syncedAt)) continue;
    result[review.shift_id] = reviewedMark(mark, review.decision, review.reason);
  }
  return result;
}
