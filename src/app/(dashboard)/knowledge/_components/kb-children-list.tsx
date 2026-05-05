import Link from "next/link";
import { ArrowUpRight } from "lucide-react";

import { KbPageIcon } from "@/components/knowledge/kb-page-icon";
import type { KbPageRow } from "@/types/knowledge";

interface KbChildrenListProps {
  /** Текущая страница, чьих children показываем. */
  pageId: string;
  /** Уже загруженный snapshot всех живых страниц (тот же что в `[slug]/page.tsx`
   *  для `countDescendants`) — чтобы не делать второй запрос в БД. */
  allPages: KbPageRow[];
}

/**
 * Notion-style auto-listing подстраниц на странице-родителе. Парная к
 * `<KbBacklinks>` секция: backlinks показывают входящие ссылки, а эта —
 * children по `parent_id`. Без неё `parent_id` живёт только в sidebar-
 * дереве и юзер не видит связи между страницами на самой странице.
 *
 * Render-time компонент: данные приходят из `allPages` snapshot'а,
 * который уже загружен в [slug]/page.tsx — нет лишнего round-trip'а в БД.
 * При перемещении страницы в дереве (`moveKbPageInTree`) и последующем
 * `router.refresh()` список здесь обновится автоматически.
 *
 * Если у страницы 0 children — секция не рендерится (без шума на
 * листовых страницах).
 */
export function KbChildrenList({ pageId, allPages }: KbChildrenListProps) {
  const children = allPages
    .filter((p) => p.parent_id === pageId)
    .sort(
      (a, b) =>
        a.position - b.position ||
        a.title.localeCompare(b.title, "ru", { sensitivity: "base" }),
    );

  if (children.length === 0) return null;

  return (
    <section
      aria-label="Подстраницы"
      className="flex flex-col gap-2 rounded-lg border bg-card p-4"
    >
      <h2 className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground/70">
        Подстраницы
      </h2>
      <ul className="flex flex-col gap-1">
        {children.map((row) => (
          <li key={row.id}>
            <Link
              href={`/knowledge/${row.slug}`}
              className="flex items-center gap-2 rounded-md px-2 py-1 text-sm hover:bg-accent"
            >
              <KbPageIcon icon={row.icon} color={row.icon_color} size={16} />
              <span className="flex-1 truncate font-medium">
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
