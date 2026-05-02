"use client";

/**
 * PageHeaderActions — слот для инъекции элементов из конкретной
 * страницы в общий header дашборда (рядом с колокольчиком).
 *
 * Используется entity-страницами (роль, сотрудник, счёт, транзакция,
 * контр-агент…) для рендера info-popover'а с метаданными
 * (id / создал / создана / изменил / изменена) — см. дизайн r5eX3.
 *
 * Паттерн: SidebarProvider оборачивает всё в layout, тут добавляется
 * ещё один client-провайдер; страница вызывает <PageHeaderActions>...
 * </PageHeaderActions>, его children мутируют контекст и рендерятся
 * в <PageHeaderActionsSlot /> (живёт в layout header).
 */

import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";

type Ctx = {
  actions: ReactNode;
  setActions: (a: ReactNode) => void;
};

const PageHeaderActionsContext = createContext<Ctx | null>(null);

export function PageHeaderActionsProvider({ children }: { children: ReactNode }) {
  const [actions, setActions] = useState<ReactNode>(null);
  return (
    <PageHeaderActionsContext.Provider value={{ actions, setActions }}>
      {children}
    </PageHeaderActionsContext.Provider>
  );
}

/** Slot — рендерит actions, заданные через `<PageHeaderActions>` */
export function PageHeaderActionsSlot() {
  const ctx = useContext(PageHeaderActionsContext);
  return <>{ctx?.actions ?? null}</>;
}

/** Page-side: оборачивает любые ноды и пушит их в slot. */
export function PageHeaderActions({ children }: { children: ReactNode }) {
  const ctx = useContext(PageHeaderActionsContext);
  useEffect(() => {
    if (!ctx) return;
    ctx.setActions(children);
    return () => {
      ctx.setActions(null);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [children]);
  return null;
}
