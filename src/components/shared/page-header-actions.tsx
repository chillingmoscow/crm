"use client";

/**
 * Page-level slots for the dashboard top bar.
 *
 * Top bar layout (см. правила в `docs/design-system.md` § Top bar):
 *
 *   [ SidebarTrigger | Breadcrumb ]   …   [ PageHeaderActions | NotificationBell ]
 *
 * - `<PageBreadcrumb>` — слева: ‹ Раздел breadcrumb-link или title.
 *   Используется на entity-страницах (детальная роль / сотрудник / etc).
 *   Пропускается для index-страниц (Должности, Сотрудники, Дашборд) —
 *   там breadcrumb не нужен, главный заголовок остаётся в теле страницы.
 *
 * - `<PageHeaderActions>` — справа: info-popover, опциональная help-кнопка
 *   и т.д. Bell живёт в layout всегда. Info button показываем только когда
 *   у сущности есть meaningful audit info (created/updated by/at).
 */

import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";

type Ctx = {
  breadcrumb: ReactNode;
  setBreadcrumb: (a: ReactNode) => void;
  actions: ReactNode;
  setActions: (a: ReactNode) => void;
};

const PageHeaderContext = createContext<Ctx | null>(null);

export function PageHeaderActionsProvider({ children }: { children: ReactNode }) {
  const [breadcrumb, setBreadcrumb] = useState<ReactNode>(null);
  const [actions, setActions] = useState<ReactNode>(null);
  return (
    <PageHeaderContext.Provider
      value={{ breadcrumb, setBreadcrumb, actions, setActions }}
    >
      {children}
    </PageHeaderContext.Provider>
  );
}

/** Slot для actions (правая сторона топбара, перед колокольчиком) */
export function PageHeaderActionsSlot() {
  const ctx = useContext(PageHeaderContext);
  return <>{ctx?.actions ?? null}</>;
}

/** Slot для breadcrumb (левая сторона топбара, после SidebarTrigger) */
export function PageHeaderBreadcrumbSlot() {
  const ctx = useContext(PageHeaderContext);
  return <>{ctx?.breadcrumb ?? null}</>;
}

/** Текущий breadcrumb-node из контекста (или null). Нужен, чтобы условно
 *  не рендерить контейнеры, когда breadcrumb не задан (напр. мобильная
 *  вторая строка шапки БЗ не должна висеть пустой полосой). */
export function usePageHeaderBreadcrumb() {
  return useContext(PageHeaderContext)?.breadcrumb ?? null;
}

/** Page-side: пушит actions в правый слот */
export function PageHeaderActions({ children }: { children: ReactNode }) {
  const ctx = useContext(PageHeaderContext);
  useEffect(() => {
    if (!ctx) return;
    ctx.setActions(children);
    return () => ctx.setActions(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [children]);
  return null;
}

/** Page-side: пушит breadcrumb в левый слот */
export function PageBreadcrumb({ children }: { children: ReactNode }) {
  const ctx = useContext(PageHeaderContext);
  useEffect(() => {
    if (!ctx) return;
    ctx.setBreadcrumb(children);
    return () => ctx.setBreadcrumb(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [children]);
  return null;
}
