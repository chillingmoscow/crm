/**
 * Pure helpers, описывающие статусную машину акта инвентаризации: какая
 * поверхность (форма заполнения / итоги ревьюера) залочена в каком статусе.
 * Единый источник правды, который переиспользуют:
 *   - server actions (`src/app/(dashboard)/inventory/actions.ts`),
 *   - форма заполнения (`document-editor.tsx`),
 *   - таблица итогов (`results-table.tsx`).
 *
 * Без импортов из `@/...`, чтобы node:test мог импортировать напрямую
 * (тест-раннер не резолвит alias из tsconfig — см. list-documents-shared.ts).
 *
 * Жизненный цикл (см. docs/handbook/inventory/statuses.md):
 *   synced → assigned → in_progress → ready_for_review | results_blocked
 *     → recount_pending → ready_for_review (петля пересчёта)
 *   Боковое: sync_error. Накладки-замки: results_finalized_at (финализация),
 *   processed + results_reopened_at (проведён в QR / разблокирован).
 */

export type InventoryActStatus =
  | "synced"
  | "assigned"
  | "in_progress"
  | "ready_for_review"
  | "recount_pending"
  | "processed"
  | "results_blocked"
  | "sync_error";

/** Минимум полей акта, достаточный для вычисления замков итогов. */
export type InventoryActLockInput = {
  status: string;
  results_finalized_at: string | null;
  results_reopened_at: string | null;
};

/**
 * Итоги залочены (read-only): финализированы (results_finalized_at) ИЛИ акт
 * проведён в QR (status='processed') и не был явно разблокирован
 * (results_reopened_at == null). Разблокировка — reopenInventoryResults.
 */
export function isInventoryResultLocked(doc: InventoryActLockInput): boolean {
  if (doc.results_finalized_at) return true;
  return doc.status === "processed" && doc.results_reopened_at == null;
}

/**
 * Инструменты ревьюера (пересорт, исключение из итогов, автоисключения,
 * комментарии, финализация) недоступны, когда итоги залочены ИЛИ акт
 * отправлен на пересчёт (status='recount_pending'): ревьюер ждёт, пока
 * исполнитель реально пересчитает, и не может «подогнать» итог. Это и есть
 * анти-подгонка из recount-механики.
 */
export function isInventoryResultAdjustLocked(doc: InventoryActLockInput): boolean {
  return isInventoryResultLocked(doc) || doc.status === "recount_pending";
}

/**
 * Статусы, в которых форма заполнения только для чтения: акт уже ушёл на
 * проверку / проведён / не синкнулся. В этих статусах исполнитель не должен
 * «дозаполнять» факт.
 */
export const FORM_LOCKED_STATUSES: readonly string[] = [
  "ready_for_review",
  "results_blocked",
  "processed",
  "sync_error",
];

/**
 * Форма заполнения только для чтения, если итоги финализированы ИЛИ статус
 * входит в FORM_LOCKED_STATUSES. Редактируема при synced / assigned /
 * in_progress / recount_pending (последний — легитимный перерасчёт).
 */
export function isInventoryFormLocked(status: string, finalized: boolean): boolean {
  return finalized || FORM_LOCKED_STATUSES.includes(status);
}
