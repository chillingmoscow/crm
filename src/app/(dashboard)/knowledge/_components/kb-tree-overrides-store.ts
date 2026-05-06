"use client";

import { useCallback, useSyncExternalStore } from "react";

/**
 * Module-level client-store для МГНОВЕННОГО обновления элементов
 * KB-tree (icon / iconColor / title), не дожидаясь RSC-roundtrip'а.
 *
 * Зачем: `getKbTree()` крутится в knowledge/layout.tsx server-side,
 * и единственный способ его пересчитать — `router.refresh()`. Но он
 * перезапрашивает ВЕСЬ RSC-poddrevo (layout + page + всё что внутри).
 *
 * Решение: после save'а title/иконки в editor'е, мы кладём оверрайд
 * в этот store. KbTreeNav читает оверрайды поверх serverNode'ов и
 * рендерит сразу. На NEXT navigation/reload свежие данные приходят с
 * сервера, оверрайды можно очистить (но и без очистки overhead'а
 * нет — Map<pageId, partial> не тяжёлый).
 *
 * **Per-id subscription** (ключевая оптимизация для KB-tree до 500+
 * нод): раньше один global Set listeners получал ВСЕ изменения,
 * useSyncExternalStore возвращал Map целиком, и сотни subscriber'ов
 * пере-рендерились на любой override. Теперь у каждого pageId свой
 * Set listener'ов; setKbTreeOverride(id, patch) дёргает только тех,
 * кто реально интересуется этим id. Хук возвращает override-value
 * напрямую, useSyncExternalStore сравнивает по Object.is — если ref
 * не поменялся (или вернулся undefined), компонент не ре-рендерится.
 */

export interface KbTreeNodeOverride {
  /** Iconика. Если undefined — наследуем server. Если null — иконка
   *  явно убрана юзером (используем fallback). Если string — кастом. */
  icon?: string | null;
  iconColor?: string | null;
  title?: string;
}

const overrides = new Map<string, KbTreeNodeOverride>();
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

/** Записать override для одной страницы. Только заданные поля
 *  переопределяются — остальные fallback'ятся к server-значениям. */
export function setKbTreeOverride(
  pageId: string,
  patch: KbTreeNodeOverride,
): void {
  const prev = overrides.get(pageId);
  // No-op'аем когда patch не меняет ничего, чтобы не дёргать слишком
  // часто (editor'ный onChange может вызываться пачкой).
  if (
    prev &&
    prev.icon === patch.icon &&
    prev.iconColor === patch.iconColor &&
    prev.title === patch.title
  ) {
    return;
  }
  overrides.set(pageId, { ...prev, ...patch });
  notifyId(pageId);
}

/** Удалить override для страницы — например, после успешного
 *  router.refresh()'а или unmount'е editor'а. Не обязательно вызывать
 *  — оверрайд просто остаётся в памяти текущей сессии. */
export function clearKbTreeOverride(pageId: string): void {
  if (!overrides.has(pageId)) return;
  overrides.delete(pageId);
  notifyId(pageId);
}

/** Hook для KB-tree-нодов: возвращает override для pageId или
 *  undefined. Per-id subscription: re-render только когда меняется
 *  override ИМЕННО этого pageId. */
export function useKbTreeOverride(
  pageId: string,
): KbTreeNodeOverride | undefined {
  const subscribe = useCallback(
    (cb: () => void) => subscribeToId(pageId, cb),
    [pageId],
  );
  const getSnapshot = useCallback(
    () => overrides.get(pageId),
    [pageId],
  );
  // SSR snapshot: всегда undefined (на сервере оверрайдов нет).
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

function getServerSnapshot(): undefined {
  return undefined;
}
