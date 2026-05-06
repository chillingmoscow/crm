import Link from "next/link";
import { ArrowUpRight } from "lucide-react";

import { KbPageIcon } from "@/components/knowledge/kb-page-icon";
import type { KbPageRow } from "@/types/knowledge";

interface KbBacklinksProps {
  /** Pre-fetched rows (см. [slug]/page.tsx — `listBacklinksTo` теперь
   *  идёт в общий Promise.all, чтобы не делать отдельный RTT после
   *  основного фетча). Sync-component без своего await. */
  rows: Array<Pick<KbPageRow, "id" | "slug" | "title" | "icon" | "icon_color">>;
}

/**
 * "На эту страницу ссылаются" — список страниц с обратными ссылками.
 * Записи в kb_page_links поддерживаются `kb_save_page` RPC при каждом
 * сохранении исходной страницы. Если ссылок нет — секция не рендерится
 * (никаких пустых заголовков «Backlinks: 0»).
 */
export function KbBacklinks({ rows }: KbBacklinksProps) {
  if (rows.length === 0) return null;

  return (
    <section
      aria-label="Обратные ссылки"
      className="flex flex-col gap-2 rounded-lg border bg-card p-4"
    >
      <h2 className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground/70">
        На эту страницу ссылаются
      </h2>
      <ul className="flex flex-col gap-1">
        {rows.map((row) => (
          <li key={row.id}>
            <Link
              href={`/knowledge/${row.slug}`}
              className="flex items-center gap-2 rounded-md px-2 py-1 text-sm hover:bg-accent"
            >
              <KbPageIcon icon={row.icon} color={row.icon_color} size={16} />
              <span className="flex-1 truncate">
                {row.title || "Без названия"}
              </span>
              <ArrowUpRight className="size-3.5 text-muted-foreground" />
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
