/**
 * Ключи черновика формы акта в IndexedDB устройства.
 *
 * Черновик свой у каждого человека: раньше ключ был один на акт, и на общем
 * планшете новый исполнитель открывал акт с числами предыдущего.
 *
 * Pure, без `@/...` — тестируется node:test напрямую.
 */

/** Ключ черновика: акт + пользователь. */
export function inventoryDraftKey(documentId: string, userId: string): string {
  return `inventory:${documentId}:${userId}`;
}

/** Старый ключ — один черновик на акт для всех, кто открывал его на устройстве. */
export function legacyInventoryDraftKey(documentId: string): string {
  return `inventory:${documentId}`;
}

/**
 * Можно ли забрать черновик со старого общего ключа. Только исполнителю акта:
 * почти наверняка числа вводил он. Проверяющий, управляющий или новый
 * исполнитель старый черновик не получают — это и есть утечка, которую
 * закрывает переход на ключ по пользователю.
 */
export function canAdoptLegacyDraft(input: { assignedTo: string | null; userId: string }): boolean {
  return Boolean(input.assignedTo) && input.assignedTo === input.userId;
}
