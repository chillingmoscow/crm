import Link from "next/link";
import { BookOpen } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { ru } from "date-fns/locale";

import { listRecentKbPages } from "@/lib/knowledge/pages";
import { EmptyState } from "@/components/ui/empty-state";
import { CreateRootPageButton } from "@/app/(dashboard)/knowledge/_components/create-root-page-button";

/**
 * KB landing screen. Lists the 10 most recently edited pages so the
 * user has something to click into immediately. Search dialog (Cmd+K)
 * lands in Stage 8.5; for now navigation is via the tree on the left
 * and the "недавнее" cards below.
 *
 * Padding 16/32 matches Sheerly's `page` frame primitive (see
 * sheerly.pen `page` nodes — top-12 gap from header, side-32 gutters).
 */
export default async function KnowledgeLandingPage() {
  const { rows } = await listRecentKbPages(10);

  return (
    // Section/index page — без breadcrumb в топбаре (per DS), title в теле.
    // Body padding и H1-стилизация по конвенции role/staff list pages.
    <div className="px-6 md:px-8 pt-4 pb-8 w-full flex flex-col gap-6">
      <header className="flex items-end justify-between gap-4">
        <div className="flex flex-col gap-1.5 min-w-0">
          <h1 className="text-[28px] font-bold tracking-tight leading-tight">
            База знаний
          </h1>
          <p className="text-sm text-muted-foreground">
            SOP, регламенты, рецепты, онбординг и внутренние материалы команды.
          </p>
        </div>
        <CreateRootPageButton />
      </header>

      <section className="flex flex-col gap-3">
        <h2 className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground/70">
          Недавнее
        </h2>
        {rows.length === 0 ? <KbEmptyState /> : <RecentList rows={rows} />}
      </section>
    </div>
  );
}

function KbEmptyState() {
  return (
    <EmptyState
      icon={BookOpen}
      title="Здесь пока нет страниц"
      description="Создайте первую страницу — например, регламент бара или чек-лист открытия смены."
      action={<CreateRootPageButton />}
    />
  );
}

function RecentList({
  rows,
}: {
  rows: Array<{
    id: string;
    slug: string;
    title: string;
    icon: string | null;
    updated_at: string | null;
    created_at: string;
  }>;
}) {
  return (
    <ul className="flex flex-col gap-1">
      {rows.map((row) => {
        const ts = row.updated_at ?? row.created_at;
        return (
          <li key={row.id}>
            <Link
              href={`/knowledge/${row.slug}`}
              className="flex items-center gap-3 rounded-md px-3 py-2 hover:bg-accent"
            >
              <span className="flex size-6 items-center justify-center text-base">
                {row.icon ?? "📄"}
              </span>
              <span className="flex-1 truncate text-sm font-medium">
                {row.title || "Без названия"}
              </span>
              <span className="text-xs text-muted-foreground">
                {formatDistanceToNow(new Date(ts), { addSuffix: true, locale: ru })}
              </span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
