"use client";

import { useSyncExternalStore } from "react";

/**
 * Module-level store для видимости KB-сайдбара.
 *
 * `hidden` — постоянное состояние (бэкается cookie `kb_sidebar_hidden`,
 * читается на сервере в knowledge/layout.tsx чтобы первый рендер был
 * без CLS). Toggle'ится кликом на иконку «База знаний» в main-sidebar
 * когда юзер уже на /knowledge.
 *
 * `peeking` — клиентское temp-состояние: hover на иконку «База знаний»
 * когда KB-сайдбар скрыт. Сайдбар выезжает overlay'ем, при mouseleave
 * закрывается через 300мс grace (чтобы юзер успел увести курсор на
 * сам сайдбар).
 *
 * Зачем module-store, а не React context: иконка в main-sidebar и сам
 * KB-сайдбар живут на разных уровнях React-дерева
 * (`(dashboard)/layout.tsx` и `(dashboard)/knowledge/layout.tsx` —
 * server-components, client-границы у каждого свои). Module-singleton +
 * `useSyncExternalStore` — то же что используется в kb-editor-store.ts
 * для Undo/Redo-кнопок.
 */

const COOKIE_KEY = "kb_sidebar_hidden";
const COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

interface State {
  hidden: boolean;
  /** Hover-overlay временно открыт. Игнорируется когда `hidden=false`. */
  peeking: boolean;
}

let state: State = { hidden: false, peeking: false };
const SERVER_STATE: State = { hidden: false, peeking: false };
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

function getSnapshot(): State {
  return state;
}

/** SSR-fallback — `peeking` всегда false, `hidden` берём из cookie
 *  (которое приходит уже как initial-state, см. KbSidebarShell.init).
 *  Для самого первого hydration'а до того как init успел отработать,
 *  возвращаем дефолт {hidden:false, peeking:false}. */
function getServerSnapshot(): State {
  return SERVER_STATE;
}

export function useKbSidebarVisibility(): State {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

/** Инициализация state'а из server-полученного cookie-значения. Вызывается
 *  ровно один раз через `<KbSidebarVisibilityInit>` в KbSidebarShell. */
export function initKbSidebarHidden(hidden: boolean) {
  if (state.hidden === hidden) return;
  state = { ...state, hidden };
  emit();
}

export function toggleKbSidebarHidden() {
  const next = !state.hidden;
  state = { hidden: next, peeking: false };
  writeCookie(COOKIE_KEY, next ? "true" : "");
  emit();
}

export function setKbSidebarPeek(peeking: boolean) {
  if (state.peeking === peeking) return;
  state = { ...state, peeking };
  emit();
}

/** Grace-таймер для hover-peek'а: и иконка, и сам overlay-сайдбар
 *  при mouseleave должны планировать «закрытие peek'а через 300мс»;
 *  любой mouseenter (на иконку или на overlay) отменяет таймер. Чтобы
 *  иконка и overlay делили один и тот же таймер (а не каждый свой),
 *  держим его в module-state'е. */
const PEEK_GRACE_MS = 300;
let peekCloseTimer: ReturnType<typeof setTimeout> | null = null;

export function cancelPeekClose() {
  if (peekCloseTimer) {
    clearTimeout(peekCloseTimer);
    peekCloseTimer = null;
  }
}

export function schedulePeekClose() {
  cancelPeekClose();
  peekCloseTimer = setTimeout(() => {
    setKbSidebarPeek(false);
    peekCloseTimer = null;
  }, PEEK_GRACE_MS);
}

function writeCookie(name: string, value: string) {
  if (typeof document === "undefined") return;
  if (value === "") {
    // Удаление cookie — max-age=0.
    document.cookie = `${name}=; path=/; max-age=0; samesite=lax`;
    return;
  }
  document.cookie =
    `${name}=${encodeURIComponent(value)}; path=/; max-age=${COOKIE_MAX_AGE}; samesite=lax`;
}
