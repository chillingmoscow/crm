"use client";

import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import type { MouseEvent } from "react";

import { PageBreadcrumb } from "./page-header-actions";

export type Crumb = {
  label: string;
  /** Нет `href` — звено без ссылки: раздел меню или текущая страница. */
  href?: string;
  /** Перехват перехода, например чтобы спросить про несохранённые изменения. */
  onClick?: (event: MouseEvent<HTMLAnchorElement>) => void;
};

/**
 * Хлебные крошки в верхней панели: «Раздел / Страница [/ Сущность]».
 * Последнее звено — текущая страница. Правила — `docs/design-system.md`,
 * раздел «Хлебные крошки».
 *
 * `back` — необязательный возврат туда, откуда пришли (`?from=…`): стрелка
 * перед путём. Сам путь от этого не меняется.
 */
export function Breadcrumbs({
  items,
  back,
}: {
  items: Crumb[];
  back?: { href: string; label: string };
}) {
  return (
    <PageBreadcrumb>
      <nav
        aria-label="Навигация по разделам"
        className="flex min-w-0 items-center gap-2 text-sm"
      >
        {back && (
          <Link
            href={back.href}
            aria-label={`Назад: ${back.label}`}
            data-tip={`Назад: ${back.label}`}
            className="-ml-1 grid size-7 shrink-0 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            <ChevronLeft className="size-4" />
          </Link>
        )}
        {items.map((item, index) => {
          const last = index === items.length - 1;
          return (
            <span key={`${index}.${item.label}`} className="contents">
              {index > 0 && (
                <span aria-hidden="true" className="text-muted-foreground">
                  /
                </span>
              )}
              {last ? (
                <span
                  aria-current="page"
                  className="min-w-0 truncate"
                  data-tip={item.label}
                  data-tip-overflow
                >
                  {item.label}
                </span>
              ) : item.href ? (
                <Link
                  href={item.href}
                  onClick={item.onClick}
                  className="shrink-0 text-muted-foreground transition-colors hover:text-foreground"
                >
                  {item.label}
                </Link>
              ) : (
                <span className="shrink-0 text-muted-foreground">
                  {item.label}
                </span>
              )}
            </span>
          );
        })}
      </nav>
    </PageBreadcrumb>
  );
}
