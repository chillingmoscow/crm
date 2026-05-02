import { notFound } from "next/navigation";
import { formatDistanceToNow } from "date-fns";
import { ru } from "date-fns/locale";

import { getKbPageBySlug } from "@/lib/knowledge/pages";
import { getKbBreadcrumbs } from "@/lib/knowledge/tree";
import { KbBreadcrumbs } from "@/app/(dashboard)/knowledge/_components/kb-breadcrumbs";

interface PageProps {
  params: Promise<{ slug: string }>;
}

/**
 * KB page view. Stage 8.3: layout + breadcrumbs + title + placeholder
 * for the editor. Stage 8.4 will mount KbBlockNoteEditor and wire
 * auto-save through saveKbPage.
 */
export default async function KbPageView({ params }: PageProps) {
  const { slug } = await params;
  const { row, error } = await getKbPageBySlug(slug);
  if (error || !row) notFound();

  const { chain } = await getKbBreadcrumbs(row.id);

  return (
    <article className="flex flex-col gap-6 px-8 py-6 max-w-4xl mx-auto">
      <KbBreadcrumbs chain={chain} />

      <header className="flex flex-col gap-2">
        <div className="flex items-center gap-3">
          {row.icon ? (
            <span className="text-3xl leading-none">{row.icon}</span>
          ) : null}
          <h1 className="text-3xl font-semibold tracking-tight">
            {row.title || "Без названия"}
          </h1>
        </div>
        {row.updated_at ? (
          <p className="text-xs text-muted-foreground">
            Обновлено{" "}
            {formatDistanceToNow(new Date(row.updated_at), {
              addSuffix: true,
              locale: ru,
            })}
          </p>
        ) : null}
      </header>

      <section
        aria-label="Содержимое страницы"
        className="rounded-lg border bg-card p-6 text-sm text-muted-foreground"
      >
        Редактор появится в Stage 8.4. Здесь будет BlockNote с автосохранением.
      </section>
    </article>
  );
}
