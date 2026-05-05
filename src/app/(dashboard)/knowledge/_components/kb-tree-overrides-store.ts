"use client";

import { useSyncExternalStore } from "react";

/**
 * Module-level client-store для МГНОВЕННОГО обновления элементов
 * KB-tree (icon / iconColor / title), не дожидаясь RSC-roundtrip'а.
 *
 * Зачем: `getKbTree()` крутится в knowledge/layout.tsx server-side,
 * и единственный способ его пересчитать — `router.refresh()`. Но он
 * перезапрашивает ВЕСЬ RSC-poddrevo (layout + page + всё что внутри),
 * что юзер видит как заметное «обновление страницы» (топбар мигает,
 * editor получает свежие props и т.п.).
 *
 * Решение: после save'а title/иконки в editor'е, мы кладём оверрайд
 * в этот store. KbTreeNav читает оверрайды поверх serverNode'ов и
 * рендерит сразу. На NEXT navigation/reload свежие данные приходят с
 * сервера, оверрайды можно очистить (но и без очистки overhead'а
 * нет — Map<pageId, partial> не тяжёлый).
 *
 * Используется в паре с editor'ом — он PUSH'ит, tree PULL'ит. State
 * шарится через useSyncExternalStore, тот же паттерн что
 * kb-editor-store.ts и kb-sidebar-visibility-store.ts.
 */

export interface KbTreeNodeOverride {
  /** Iconика. Если undefined — наследуем server. Если null — иконка
   *  явно убрана юзером (используем fallback). Если string — кастом. */
  icon?: string | null;
  iconColor?: string | null;
  title?: string;
}

let overrides = new Map<string, KbTreeNodeOverride>();
const listeners = new Set<() => void>();

function emit() {
  // Создаём свежий Map ref'ом, чтобы useSyncExternalStore'овский
  // referential-check заметил изменение. Без этого setKbTreeOverride
  // мутировал Map, getSnapshot возвращал тот же ref → React не
  // re-render'ил подписчиков.
  overrides = new Map(overrides);
  for (const l of listeners) l();
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

function getSnapshot(): Map<string, KbTreeNodeOverride> {
  return overrides;
}

function getServerSnapshot(): Map<string, KbTreeNodeOverride> {
  // На SSR никаких оверрайдов нет — всё из server-данных
  // (knowledge/layout.tsx → getKbTree).
  return EMPTY_MAP;
}
const EMPTY_MAP = new Map<string, KbTreeNodeOverride>();

/** Записать override для одной страницы. Только заданные поля
 *  переопределяются — остальные fallback'ятся к server-значениям. */
export function setKbTreeOverride(pageId: string, patch: KbTreeNodeOverride) {
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
  emit();
}

/** Удалить override для страницы — например, после успешного
 *  router.refresh()'а или unmount'е editor'а. Не обязательно вызывать
 *  — оверрайд просто остаётся в памяти текущей сессии. */
export function clearKbTreeOverride(pageId: string) {
  if (!overrides.has(pageId)) return;
  overrides.delete(pageId);
  emit();
}

/** Hook для KB-tree-нодов: возвращает override для pageId или
 *  undefined. Селектор-уровень — только тот override, что связан с
 *  pageId, чтобы не re-render'ить все ноды на любое изменение. */
export function useKbTreeOverride(
  pageId: string,
): KbTreeNodeOverride | undefined {
  // useSyncExternalStore возвращает Map целиком; селектор делаем
  // снаружи hook'а — компонент-нод вытаскивает override и сравнивает.
  // Map identity меняется только когда есть реальное изменение (см.
  // emit), поэтому RSC-tree не страдает от лишних реренеров.
  const map = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  return map.get(pageId);
}
