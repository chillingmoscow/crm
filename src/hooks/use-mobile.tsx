import * as React from "react"

const MOBILE_BREAKPOINT = 768

export function useIsMobile() {
  const [isMobile, setIsMobile] = React.useState<boolean | undefined>(undefined)

  React.useEffect(() => {
    const mql = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`)
    const onChange = () => {
      setIsMobile(window.innerWidth < MOBILE_BREAKPOINT)
    }
    mql.addEventListener("change", onChange)
    setIsMobile(window.innerWidth < MOBILE_BREAKPOINT)
    return () => mql.removeEventListener("change", onChange)
  }, [])

  return !!isMobile
}

const COARSE_POINTER_QUERY = "(hover: none), (pointer: coarse)"

function readCoarsePointer(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia(COARSE_POINTER_QUERY).matches
  )
}

/**
 * Единый сигнал «тач-режим» (нет hover / грубый указатель) — для всего
 * touch-специфичного UI редактора БЗ и не только.
 *
 * Отличия от useIsMobile:
 *   • гейт по INPUT-MODE, а не по ширине экрана — тач-планшет шире 768px
 *     это тоже тач, а узкое desktop-окно с мышью — нет (Codex P2 #442).
 *   • значение КОРРЕКТНО синхронно на первом рендере (lazy-инициализатор
 *     useState), т.к. useIsMobile возвращает false до отработки effect'а —
 *     это ломало mount-only props вроде autoFocus (Codex P1 #443).
 *
 * Реактивно обновляется по `change` (подключили/отключили клавиатуру и т.п.).
 */
export function useCoarsePointer(): boolean {
  const [coarse, setCoarse] = React.useState<boolean>(readCoarsePointer)

  React.useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return
    const mql = window.matchMedia(COARSE_POINTER_QUERY)
    const onChange = () => setCoarse(mql.matches)
    mql.addEventListener("change", onChange)
    setCoarse(mql.matches)
    return () => mql.removeEventListener("change", onChange)
  }, [])

  return coarse
}
