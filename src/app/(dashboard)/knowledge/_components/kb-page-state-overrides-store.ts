"use client";

import { useSyncExternalStore } from "react";

/**
 * Module-level client-store для МГНОВЕННОГО обновления page-level
 * boolean-флагов (lock + required-reading), не дожидаясь RSC-roundtrip'а.
 *
 * Зачем: оба toggle'а до этого делали `router.refresh()` после успешного
 * server-action'а. router.refresh() форсирует full RSC re-fetch текущего
 * route'а (все 10 запросов в [slug]/page.tsx Promise.all + всё в layout)
 * → 300-600мс perceived latency. В Notion-аналоге toggle ощущается как
 * мгновенный — этого мы и добиваемся.
 *
 * Решение: после server-action'а мы сразу пишем оверрайд в этот store.
 * Consumer'ы (KbPageEditor для canEdit-gate, KbTreeItem для lock-icon в
 * sidebar, banner для required-reading отображения) читают оверрайд
 * поверх server-prop'ов. На NEXT navigation/reload свежие данные приходят
 * с сервера (revalidatePath на сервере уже инвалидировал кэш), оверрайд
 * становится no-op'ом по equality.
 *
 * Тот же паттерн что `kb-tree-overrides-store.ts` — useSyncExternalStore
 * с per-page Map'ом.
 */

export interface KbPageStateOverride {
  /** Lock-флаг. true = страница заблокирована (canEdit=false для всех).
   *  undefined = используем server-значение `row.locked_at !== null`. */
  locked?: boolean;
  /** Required-reading флаг (admin toggle). undefined = используем server. */
  requiredReading?: boolean;
}

let overrides = new Map<string, KbPageStateOverride>();
const listeners = new Set<() => void>();

function emit() {
  // Свежий Map ref ради referential-check в useSyncExternalStore. Без
  // этого мутация на месте → getSnapshot возвращает тот же ref →
  // подписчики не ре-рендерятся.
  overrides = new Map(overrides);
  for (const l of listeners) l();
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

function getSnapshot(): Map<string, KbPageStateOverride> {
  return overrides;
}

const EMPTY_MAP = new Map<string, KbPageStateOverride>();
function getServerSnapshot(): Map<string, KbPageStateOverride> {
  return EMPTY_MAP;
}

/** Записать override для одной страницы. patch — только те поля,
 *  которые меняются; остальные fallback'ятся к server-значениям. */
export function setKbPageStateOverride(
  pageId: string,
  patch: KbPageStateOverride,
): void {
  const prev = overrides.get(pageId);
  // No-op если patch ничего не меняет (defensive — иначе emit'ы могли
  // бы дёргать подписчиков лишний раз при двойных кликах).
  if (prev) {
    const sameLock =
      patch.locked === undefined || prev.locked === patch.locked;
    const sameReq =
      patch.requiredReading === undefined ||
      prev.requiredReading === patch.requiredReading;
    if (sameLock && sameReq) return;
  }
  overrides.set(pageId, { ...prev, ...patch });
  emit();
}

/** Удалить override для страницы (например после успешного reload'а
 *  когда server-данные уже актуальны). Не обязательно — оверрайд
 *  безвреден, просто остаётся в памяти текущей сессии. */
export function clearKbPageStateOverride(pageId: string): void {
  if (!overrides.has(pageId)) return;
  overrides.delete(pageId);
  emit();
}

/** Hook для consumer'ов. Возвращает override для pageId или undefined.
 *  Подписка через useSyncExternalStore — на любое emit() React
 *  ре-рендерит подписчика; селектор `.get(pageId)` оставляем component'у. */
export function useKbPageStateOverride(
  pageId: string,
): KbPageStateOverride | undefined {
  const map = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  return map.get(pageId);
}
