import Link from "next/link";
import { BookOpen } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { ru } from "date-fns/locale";

import { listRecentKbPages } from "@/lib/knowledge/pages";
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
    <div className="flex flex-col gap-6 px-8 py-6">
      <header className="flex items-end justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold tracking-tight">База знаний</h1>
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
        {rows.length === 0 ? <EmptyState /> : <RecentList rows={rows} />}
      </section>
    </div>
  );
}

function EmptyState() {
  return (
    // Sheerly empty-state spec (`p2umw`): muted background, p-32, gap-16,
    // min-height 320, vertically centred. См. sheerly.pen Q4FzoZ §13.
    <div
      className="flex min-h-[320px] flex-col items-center justify-center gap-4
                 rounded-xl border bg-muted/40 p-8 text-center"
    >
      <BookOpen className="size-8 text-muted-foreground" />
      <div className="flex flex-col gap-1">
        <p className="text-sm font-medium">Здесь пока нет страниц</p>
        <p className="text-sm text-muted-foreground max-w-sm">
          Создайте первую страницу — например, регламент бара или чек-лист открытия смены.
        </p>
      </div>
      <CreateRootPageButton />
    </div>
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
