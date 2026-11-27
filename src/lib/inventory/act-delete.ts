// Удаление акта инвентаризации: что делать с его копией в Quick Resto.
//
// Акт из Quick Resto удаляем сначала там, потом у нас. Quick Resto удаляет
// «мягко»: акт остаётся читаемым с `deleted: true`, синхронизация такие акты
// не заводит заново (isRecentOpenInventoryDocument), а повторное удаление
// отвечает 200 — проверено на проде 27.11.2026 (тестовый акт 10973).
//
// Pure-модуль без импортов из `@/...`: его читает node:test напрямую.

/** Что сделать с актом в Quick Resto перед удалением у нас. */
export type QuickRestoDeleteStep =
  /** Не проведён — удалить в Quick Resto, потом у нас. */
  | "remove"
  /** Проведён — сначала отменить проведение (остатки пересчитаются), потом удалить. */
  | "unprocess"
  /** Уже удалён в Quick Resto — удаляем только у нас. */
  | "already_deleted"
  /** Quick Resto акт не вернул (другой id или пусто) — удаляем только у нас. */
  | "missing"
  /** Quick Resto сейчас проводит акт или отменяет проведение — подождать. */
  | "busy"
  /** Ответ без явного признака проведения — не удаляем нигде (лучше отказать,
   *  чем удалить по неполному ответу). */
  | "unknown";

/** Как удалён акт: пишется в журнал событий (`details.quickresto`). */
export type QuickRestoDeleteOutcome =
  | "deleted"
  | "unprocessed_and_deleted"
  | "already_deleted"
  | "missing"
  | "not_linked";

/** Числовой id акта в Quick Resto или null, если акт с ним не связан. */
export function quickRestoActId(externalId: string | null | undefined): number | null {
  if (!externalId) return null;
  const id = Number(externalId);
  return Number.isInteger(id) && id > 0 ? id : null;
}

/**
 * Шаг по акту, прочитанному из бэк-офиса Quick Resto. Удаляем сразу только
 * при явном «не проведён» (`processed === false`, `processingState` нет или
 * UNPROCESSED). Проведённый (`processed === true`, состояние PROCESSED или
 * его нет) — сначала распроводим. Промежуточные состояния (PROCESSING,
 * CANCELLING) — ждём. Ответ без признаков — `unknown`, удаления нет.
 */
export function quickRestoDeleteStep(
  document: Record<string, unknown> | null | undefined,
  externalId: number,
): QuickRestoDeleteStep {
  if (!document || document.id !== externalId) return "missing";
  if (document.deleted === true) return "already_deleted";
  const state = document.processingState;
  if (state !== undefined && state !== null && typeof state !== "string") return "unknown";
  if (typeof state === "string" && state !== "UNPROCESSED" && state !== "PROCESSED") return "busy";
  if (document.processed === true) return state === "UNPROCESSED" ? "busy" : "unprocess";
  if (document.processed === false) return state === "PROCESSED" ? "busy" : "remove";
  return "unknown";
}

export function quickRestoDeleteFailedMessage(documentNumber: string | null | undefined): string {
  const number = documentNumber?.trim();
  return `Quick Resto не удалил акт${number ? ` № ${number}` : ""} — у нас он тоже остался. Попробуйте ещё раз через минуту.`;
}

export function deletedOnlyInQuickRestoMessage(documentNumber: string | null | undefined): string {
  const number = documentNumber?.trim();
  return `Акт${number ? ` № ${number}` : ""} удалён в Quick Resto, но здесь его за это время провели или утвердили итоги — у нас он остался. Проверьте акт в Quick Resto.`;
}

export function quickRestoBusyMessage(documentNumber: string | null | undefined): string {
  const number = documentNumber?.trim();
  return `Quick Resto сейчас проводит акт${number ? ` № ${number}` : ""} или отменяет проведение. Попробуйте удалить через минуту.`;
}

export function unprocessedNotDeletedMessage(documentNumber: string | null | undefined): string {
  const number = documentNumber?.trim();
  return `Проведение акта${number ? ` № ${number}` : ""} в Quick Resto отменено, но удалить его не удалось — акт остался и там, и здесь. Повторите удаление через минуту.`;
}

export function processedNeedsConfirmMessage(documentNumber: string | null | undefined): string {
  const number = documentNumber?.trim();
  return `Акт${number ? ` № ${number}` : ""} проведён в Quick Resto, а у нас это ещё не видно. Обновите страницу: удаление проведённого акта сначала отменит его проведение.`;
}
