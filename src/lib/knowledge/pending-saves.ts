"use client";

/** Module-scope registry of in-flight «flush pending edits» callbacks
 *  — used by lock/delete-like actions, чтобы дождаться debounced-save'а
 *  редактора ДО смены UI-режима или удаления. Без этого пользователь
 *  может визуально выйти из edit-mode до того, как последний save ушёл
 *  на сервер. См. Codex #65 P2.
 *
 *  На странице обычно ровно один `KbPageEditor`, но регистр сделан
 *  Set'ом — на случай side-by-side редактирования в будущем. */
type FlushFn = () => Promise<void>;

const pendingFlushes = new Set<FlushFn>();

export function registerPendingSaveFlush(fn: FlushFn): () => void {
  pendingFlushes.add(fn);
  return () => {
    pendingFlushes.delete(fn);
  };
}

/** Awaits ALL зарегистрированные flush'и параллельно. Используется
 *  перед action'ами, которые могут racнуться с auto-save'ом
 *  (lock toggle, soft-delete, etc.). */
export async function flushAllPendingSaves(): Promise<void> {
  if (pendingFlushes.size === 0) return;
  await Promise.all(Array.from(pendingFlushes).map((fn) => fn()));
}
