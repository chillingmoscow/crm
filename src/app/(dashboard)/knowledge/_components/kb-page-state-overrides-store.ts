"use client";

import { useCallback, useSyncExternalStore } from "react";

/**
 * Module-level client-store для МГНОВЕННОГО обновления page-level
 * boolean-флагов (lock + required-reading), не дожидаясь RSC-roundtrip'а.
 *
 * См. kb-tree-overrides-store.ts для общего паттерна. Per-id subscription:
 * каждый pageId имеет свой Set listener'ов; setKbPageStateOverride(id, ...)
 * дёргает только тех, кто реально слушает этот id. Это критично для
 * KB-tree до 500+ нод — иначе любой toggle бы re-render'ил все ноды.
 */

export interface KbPageStateOverride {
  /** Lock-флаг. true = страница заблокирована (canEdit=false для всех).
   *  undefined = используем server-значение `row.locked_at !== null`. */
  locked?: boolean;
  /** Required-reading флаг (admin toggle). undefined = используем server. */
  requiredReading?: boolean;
}

const overrides = new Map<string, KbPageStateOverride>();
const listenersByPageId = new Map<string, Set<() => void>>();

function notifyId(pageId: string) {
  const set = listenersByPageId.get(pageId);
  if (!set || set.size === 0) return;
  for (const l of set) l();
}

function subscribeToId(pageId: string, cb: () => void): () => void {
  let set = listenersByPageId.get(pageId);
  if (!set) {
    set = new Set();
    listenersByPageId.set(pageId, set);
  }
  set.add(cb);
  return () => {
    set!.delete(cb);
    if (set!.size === 0) listenersByPageId.delete(pageId);
  };
}

/** Записать override для одной страницы. patch — только те поля,
 *  которые меняются; остальные fallback'ятся к server-значениям. */
export function setKbPageStateOverride(
  pageId: string,
  patch: KbPageStateOverride,
): void {
  const prev = overrides.get(pageId);
  // No-op если patch ничего не меняет.
  if (prev) {
    const sameLock =
      patch.locked === undefined || prev.locked === patch.locked;
    const sameReq =
      patch.requiredReading === undefined ||
      prev.requiredReading === patch.requiredReading;
    if (sameLock && sameReq) return;
  }
  overrides.set(pageId, { ...prev, ...patch });
  notifyId(pageId);
}

/** Удалить override для страницы (например после успешного reload'а
 *  когда server-данные уже актуальны). Не обязательно — оверрайд
 *  безвреден, остаётся в памяти текущей сессии. */
export function clearKbPageStateOverride(pageId: string): void {
  if (!overrides.has(pageId)) return;
  overrides.delete(pageId);
  notifyId(pageId);
}

/** Hook для consumer'ов. Возвращает override для pageId или undefined.
 *  Per-id subscription: re-render только когда меняется override
 *  ИМЕННО этого pageId. */
export function useKbPageStateOverride(
  pageId: string,
): KbPageStateOverride | undefined {
  const subscribe = useCallback(
    (cb: () => void) => subscribeToId(pageId, cb),
    [pageId],
  );
  const getSnapshot = useCallback(
    () => overrides.get(pageId),
    [pageId],
  );
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

function getServerSnapshot(): undefined {
  return undefined;
}
