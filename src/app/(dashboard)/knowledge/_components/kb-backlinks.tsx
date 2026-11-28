import Link from "next/link";
import { ArrowUpRight } from "lucide-react";

import { KbDocSection } from "@/app/(dashboard)/knowledge/_components/kb-doc-section";
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
    <KbDocSection title="Ссылаются сюда" count={rows.length}>
      <ul className="-mx-2 flex flex-col gap-0.5">
        {rows.map((row) => (
          <li key={row.id}>
            <Link
              href={`/knowledge/${row.slug}`}
              className="group/title flex min-h-9 items-center gap-2.5 rounded-md px-2 text-sm transition-colors hover:bg-accent"
            >
              <KbPageIcon icon={row.icon} color={row.icon_color} size={16} />
              <span className="flex-1 truncate transition-colors group-hover/title:text-brand">
                {row.title || "Без названия"}
              </span>
              <ArrowUpRight className="size-3.5 text-muted-foreground" />
            </Link>
          </li>
        ))}
      </ul>
    </KbDocSection>
  );
}
