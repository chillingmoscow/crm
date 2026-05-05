"use client";

import { createContext, useContext, useMemo, type ReactNode } from "react";

/** Состояние резолвинга mention-slug'ов в редакторе.
 *
 *  `checkedSlugs` — те slug'и, которые сервер реально проверял
 *  (соответствует множеству slug'ов, найденных в `row.content` на момент
 *  SSR). Ключ-аспект: chip, добавленный пользователем УЖЕ ПОСЛЕ
 *  SSR-фетча (через `@`-меню), отсутствует в этом множестве, и его
 *  следует считать «доступным» по умолчанию — иначе только что
 *  вставленные mention'ы автоматически перечёркивались бы (Codex bug
 *  #100-followup).
 *
 *  `deletedSlugs` — подмножество checkedSlugs, для которых
 *  обнаружено `deleted_at IS NOT NULL` (или которых вообще нет в
 *  kb_pages: hard-delete / импорт из чужого аккаунта).
 *
 *  `null` оба = резолвер не подключён → все chip'ы рендерятся как
 *  legacy-active (graceful degrade для read-only mounts вроде
 *  trash-preview). */
type KbMentionContextValue = {
  checkedSlugs: Set<string> | null;
  deletedSlugs: Set<string> | null;
};

const KbMentionContext = createContext<KbMentionContextValue>({
  checkedSlugs: null,
  deletedSlugs: null,
});

export interface KbMentionResolutionProviderProps {
  /** Все slug'и, которые сервер собрал из `row.content` через
   *  `extractBacklinks` и фактически отправил в БД на проверку. Любой
   *  slug ВНЕ этого множества считается «свежевставленным» и рендерится
   *  как живой. null/undefined = резолвинг отключён. */
  checkedSlugs?: string[] | null;
  /** Подмножество `checkedSlugs`, для которых таргет-страница в корзине
   *  (deleted_at IS NOT NULL) ИЛИ вообще не найден в kb_pages. */
  deletedSlugs?: string[] | null;
  children: ReactNode;
}

export function KbMentionResolutionProvider({
  checkedSlugs,
  deletedSlugs,
  children,
}: KbMentionResolutionProviderProps) {
  const value = useMemo<KbMentionContextValue>(
    () => ({
      checkedSlugs: checkedSlugs ? new Set(checkedSlugs) : null,
      deletedSlugs: deletedSlugs ? new Set(deletedSlugs) : null,
    }),
    [checkedSlugs, deletedSlugs],
  );
  return (
    <KbMentionContext.Provider value={value}>
      {children}
    </KbMentionContext.Provider>
  );
}

/** Возвращает `false` ТОЛЬКО если резолвер прямо подтвердил, что slug
 *  ведёт на удалённую/несуществующую страницу. В остальных случаях —
 *  `true` (включая «slug ещё не проверен», т.е. свежевставленные
 *  через `@`-меню chip'ы). Это инверсия от первой версии: раньше
 *  «active = в liveSlugs», что некорректно ловило пост-SSR вставки. */
export function useIsKbSlugAvailable(slug: string): boolean {
  const { checkedSlugs, deletedSlugs } = useContext(KbMentionContext);
  if (checkedSlugs === null || deletedSlugs === null) return true;
  if (!checkedSlugs.has(slug)) return true;
  return !deletedSlugs.has(slug);
}
