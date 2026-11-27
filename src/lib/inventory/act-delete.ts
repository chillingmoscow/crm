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
  /** Удалить в Quick Resto, потом у нас. */
  | "remove"
  /** Уже удалён в Quick Resto — удаляем только у нас. */
  | "already_deleted"
  /** Quick Resto акт не вернул (другой id или пусто) — удаляем только у нас. */
  | "missing"
  /** Проведён в Quick Resto — не удаляем нигде. */
  | "processed";

/** Как удалён акт: пишется в журнал событий (`details.quickresto`). */
export type QuickRestoDeleteOutcome = Exclude<QuickRestoDeleteStep, "processed" | "remove"> | "deleted" | "not_linked";

/** Числовой id акта в Quick Resto или null, если акт с ним не связан. */
export function quickRestoActId(externalId: string | null | undefined): number | null {
  if (!externalId) return null;
  const id = Number(externalId);
  return Number.isInteger(id) && id > 0 ? id : null;
}

/**
 * Шаг по акту, прочитанному из бэк-офиса Quick Resto. Признаки проведения —
 * как у смены даты: `processed` или любое `processingState`, кроме
 * UNPROCESSED (акт в процессе проведения тоже не трогаем).
 */
export function quickRestoDeleteStep(
  document: Record<string, unknown> | null | undefined,
  externalId: number,
): QuickRestoDeleteStep {
  if (!document || document.id !== externalId) return "missing";
  if (document.deleted === true) return "already_deleted";
  if (document.processed === true) return "processed";
  if (typeof document.processingState === "string" && document.processingState !== "UNPROCESSED") {
    return "processed";
  }
  return "remove";
}

export function actLabel(documentNumber: string | null | undefined): string {
  const number = documentNumber?.trim();
  return number ? `Акт № ${number}` : "Акт";
}

export function processedInQuickRestoMessage(documentNumber: string | null | undefined): string {
  return `${actLabel(documentNumber)} проведён в Quick Resto — удалить его нельзя. Если он не нужен, сначала распроведите его в Quick Resto.`;
}

export function quickRestoDeleteFailedMessage(documentNumber: string | null | undefined): string {
  const number = documentNumber?.trim();
  return `Quick Resto не удалил акт${number ? ` № ${number}` : ""} — у нас он тоже остался. Попробуйте ещё раз через минуту.`;
}
