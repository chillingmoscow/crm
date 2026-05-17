/** Категории фильтра журнала KB → наборы action_code. «Все события»
 *  = без фильтра. Переименование / блокировка / обязательное чтение
 *  и т.п. остаются видны только под «Все события» (дизайн `gd7E2` —
 *  4 чипа: Все · Создание · Удаление · Перемещение).
 *
 *  Plain-модуль (без "use server"): импортируется и сервером, и
 *  клиентским компонентом чипов — там нельзя экспортировать
 *  не-async из server-action файла.
 */
export const KB_AUDIT_KINDS = {
  created: ["kb_page.created"],
  deleted: ["kb_page.deleted"],
  moved: ["kb_page.moved"],
} as const;

export type KbAuditKind = keyof typeof KB_AUDIT_KINDS;

/** Ключи для счётчиков на чипах: «все» + категории. */
export type KbAuditCountKey = "all" | KbAuditKind;

export function kbAuditActionCodes(
  kind: string | undefined,
): string[] | undefined {
  // Object.hasOwn — не inherited: иначе ?kind=__proto__/toString
  // прошли бы `in`, а спред не-массива упал бы 500 (Codex #316 P1).
  if (kind && Object.hasOwn(KB_AUDIT_KINDS, kind)) {
    return [...KB_AUDIT_KINDS[kind as KbAuditKind]];
  }
  return undefined;
}
