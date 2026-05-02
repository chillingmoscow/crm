import Link from "next/link";
import { ArrowUpRight } from "lucide-react";

import { listBacklinksTo } from "@/lib/knowledge/pages";

interface KbBacklinksProps {
  pageId: string;
}

/**
 * "На эту страницу ссылаются" — список страниц с обратными ссылками.
 * Записи в kb_page_links поддерживаются `kb_save_page` RPC при каждом
 * сохранении исходной страницы. Если ссылок нет — секция не рендерится
 * (никаких пустых заголовков «Backlinks: 0»).
 */
export async function KbBacklinks({ pageId }: KbBacklinksProps) {
  const { rows } = await listBacklinksTo(pageId);
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
              <span className="text-base leading-none">
                {row.icon ?? "📄"}
              </span>
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
