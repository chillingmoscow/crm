import Link from "next/link";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";
import { KbPageIcon } from "@/components/knowledge/kb-page-icon";
import type { KbLandingPageRow } from "@/lib/knowledge/landing";

/** Sprint D Phase 6 — общий контейнер для landing-секции (заголовок +
 *  список страниц). Используется required-unread / favorites / recent-
 *  viewed виджетами с минимальными вариациями.
 *
 *  Если `rows.length === 0` — секция вообще не рендерится. UX-правило:
 *  пустые секции на landing'е создают ощущение «незаполненной
 *  системы». Если favourite'ов нет — лучше скрыть, чем показывать
 *  empty state. */
interface KbLandingSectionProps {
  title: string;
  /** Опциональный subtitle/right-slot — для счётчиков типа «5
   *  непрочитанных», cta-link «Все», и т.п. */
  trailing?: ReactNode;
  /** Иконка-маркер слева от заголовка (lucide icon). */
  leadingIcon?: ReactNode;
  rows: KbLandingPageRow[];
  /** Опциональный "trailing" слот рендера справа от каждого row'а
   *  (например relative-time, badge'и). Принимает row, возвращает
   *  ReactNode. */
  rowTrailing?: (row: KbLandingPageRow) => ReactNode;
}

export function KbLandingSection({
  title,
  trailing,
  leadingIcon,
  rows,
  rowTrailing,
}: KbLandingSectionProps) {
  if (rows.length === 0) return null;
  return (
    <section className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2 px-1">
        <h2
          className={cn(
            "text-[11px] font-medium uppercase tracking-wider text-muted-foreground/70",
            "inline-flex items-center gap-1.5",
          )}
        >
          {leadingIcon}
          {title}
        </h2>
        {trailing}
      </div>
      <ul className="flex flex-col gap-px">
        {rows.map((row) => (
          <li key={row.id}>
            <Link
              href={`/knowledge/${row.slug}`}
              className="flex items-center gap-3 rounded-md px-3 py-2 hover:bg-accent transition-colors"
            >
              <KbPageIcon icon={row.icon} color={row.icon_color} size={18} />
              <span className="flex-1 truncate text-sm font-medium">
                {row.title || "Без названия"}
              </span>
              {rowTrailing?.(row)}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
