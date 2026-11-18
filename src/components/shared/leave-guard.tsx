"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";

import { ConfirmDialog } from "@/components/shared/confirm-dialog";

/**
 * Защита ухода со страницы с несохранёнными изменениями.
 *
 * - Перезагрузка, закрытие вкладки, переход по внешнему адресу — штатное
 *   предупреждение браузера (`beforeunload`).
 * - Переход по ссылке внутри приложения (меню, хлебные крошки, ссылки на
 *   странице) — перехватывается до Next `Link` и спрашивает «Не сохранять
 *   изменения?». Клики с модификаторами, `target="_blank"` и `download`
 *   не трогаем: они не уводят с текущей страницы.
 *
 * Механизм тот же, что в экране задачи (`schedule/tasks/tasks-client.tsx`);
 * новые экраны берут его отсюда. Программные переходы (`router.push`)
 * не перехватываются — их вызывает сам экран после сохранения.
 *
 * Возвращает диалог подтверждения: его нужно отрендерить.
 */
export function useLeaveGuard(active: boolean): ReactNode {
  const router = useRouter();
  const [pendingHref, setPendingHref] = useState<string | null>(null);

  useEffect(() => {
    if (!active) return;
    const guardUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    const guardLink = (event: MouseEvent) => {
      if (
        event.defaultPrevented ||
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey
      )
        return;
      const anchor =
        event.target instanceof Element
          ? event.target.closest<HTMLAnchorElement>("a[href]")
          : null;
      if (
        !anchor ||
        anchor.target === "_blank" ||
        anchor.hasAttribute("download")
      )
        return;
      const url = new URL(anchor.href);
      if (
        url.origin !== window.location.origin ||
        (url.pathname === window.location.pathname &&
          url.search === window.location.search)
      )
        return;
      // Путь вида «//host/…» router.push понял бы как адрес другого сайта:
      // перехватываем только обычные пути внутри приложения, остальное
      // уходит браузеру и закрывается предупреждением beforeunload.
      const path = url.pathname + url.search + url.hash;
      if (!/^\/(?!\/)/.test(path)) return;
      event.preventDefault();
      event.stopPropagation();
      setPendingHref(path);
    };
    window.addEventListener("beforeunload", guardUnload);
    document.addEventListener("click", guardLink, true);
    return () => {
      window.removeEventListener("beforeunload", guardUnload);
      document.removeEventListener("click", guardLink, true);
    };
  }, [active]);

  return (
    <ConfirmDialog
      open={pendingHref !== null}
      onOpenChange={(open) => {
        if (!open) setPendingHref(null);
      }}
      title="Не сохранять изменения?"
      description="Вы уходите со страницы. Несохранённые изменения будут потеряны."
      confirmLabel="Уйти без сохранения"
      destructive
      onConfirm={() => {
        const href = pendingHref;
        setPendingHref(null);
        if (href) router.push(href);
      }}
    />
  );
}
