"use client";

import { createContext, useContext, useMemo, type ReactNode } from "react";

/** Set of KB slugs известно живых на момент server-render'а. `null`
 *  означает «не резолвили» — в этом случае mention рендерится по-
 *  старому, без disabled-варианта (graceful degrade для мест, где
 *  resolver просто не подключён, например стороннее использование
 *  редактора). */
const KbMentionContext = createContext<{ liveSlugs: Set<string> | null }>({
  liveSlugs: null,
});

export interface KbMentionResolutionProviderProps {
  /** Список slug'ов, чьи target-страницы существуют и не находятся в
   *  корзине. Caller считает это server-side через
   *  `resolveLiveKbSlugs(...)` от собранных в content slug'ов
   *  (см. extractBacklinks). null/undefined = резолвинг отключён. */
  liveSlugs?: string[] | null;
  children: ReactNode;
}

export function KbMentionResolutionProvider({
  liveSlugs,
  children,
}: KbMentionResolutionProviderProps) {
  const value = useMemo(
    () => ({
      liveSlugs:
        liveSlugs && liveSlugs.length >= 0 ? new Set(liveSlugs) : null,
    }),
    [liveSlugs],
  );
  return (
    <KbMentionContext.Provider value={value}>
      {children}
    </KbMentionContext.Provider>
  );
}

/** Возвращает `true` если slug гарантированно ведёт на живую страницу;
 *  `false` если резолвер пометил его как недоступный. Если резолвер
 *  не подключён (`liveSlugs === null`) — возвращает `true` (legacy-
 *  поведение, chip остаётся кликабельным). */
export function useIsKbSlugAvailable(slug: string): boolean {
  const { liveSlugs } = useContext(KbMentionContext);
  if (liveSlugs === null) return true;
  return liveSlugs.has(slug);
}
