import Link from "next/link";
import type { ReactNode } from "react";
import { BookCheck, CheckCircle2, Clock, RotateCcw } from "lucide-react";

import { HomeSection } from "@/app/(dashboard)/dashboard/_components/section";
import { KbReadingActions } from "@/app/(dashboard)/knowledge/_components/kb-reading-actions";
import { Button } from "@/components/ui/button";
import { KbPageIcon } from "@/components/knowledge/kb-page-icon";
import { countRu } from "@/lib/format/plural";
import type { KbAnalyticsTopPage } from "@/lib/knowledge/analytics";
import type { KbRequiredReadingOverviewRow } from "@/lib/knowledge/required-reading";
import { cn } from "@/lib/utils";

const people = (n: number) => countRu(n, "человек", "человека", "человек");

function AttentionRow({
  icon: Icon,
  tone,
  title,
  detail,
  action,
  index,
}: {
  icon: typeof BookCheck;
  tone: "warning" | "info" | "neutral";
  title: ReactNode;
  detail?: ReactNode;
  action: ReactNode;
  index: number;
}) {
  return (
    <li
      className="table-row-in flex flex-wrap items-center gap-x-3 gap-y-2 px-2 py-3 first:pt-0 last:pb-0 sm:flex-nowrap"
      style={{ animationDelay: `${index * 40}ms` }}
    >
      <span
        className={cn(
          "grid size-9 shrink-0 place-items-center rounded-md",
          tone === "warning" && "bg-amber-500/10 text-amber-700 dark:text-amber-400",
          tone === "info" && "bg-brand/10 text-brand",
          tone === "neutral" && "bg-muted text-muted-foreground",
        )}
      >
        <Icon className="size-4" aria-hidden />
      </span>
      {/* На телефоне действия уходят под текст, чтобы не сжимать его в столбик. */}
      <span className="min-w-0 flex-1 basis-[calc(100%-48px)] sm:basis-auto">
        <span className="block text-sm font-medium">{title}</span>
        {detail ? <span className="block text-xs text-muted-foreground">{detail}</span> : null}
      </span>
      <span className="ml-12 shrink-0 sm:ml-0">{action}</span>
    </li>
  );
}

const pageName = (title: string) => `«${title.trim() || "Без названия"}»`;

/**
 * «Требует внимания» (как на «Сегодня»): обязательные страницы, которые не
 * прочитали, — «Напомнить»; изменённые после прочтения — «Попросить
 * перечитать» или «Не нужно»; одной строкой — страницы без правок полгода.
 */
export function KbOverviewAttention({
  reading,
  staleCount,
}: {
  reading: KbRequiredReadingOverviewRow[];
  staleCount: number;
}) {
  const changed = reading.filter((r) => r.changedAfterRead);
  const unread = reading.filter((r) => r.remindCount > 0);
  const total = changed.length + unread.length + (staleCount > 0 ? 1 : 0);
  let index = 0;

  return (
    <HomeSection title={total ? `Требует внимания · ${total}` : "Требует внимания"}>
      {total === 0 ? (
        <div className="flex items-center gap-3 py-2">
          <span className="grid size-9 shrink-0 place-items-center rounded-full bg-emerald-500/10 text-emerald-700 dark:text-emerald-400">
            <CheckCircle2 className="size-5" aria-hidden />
          </span>
          <span className="min-w-0">
            <span className="block text-sm font-medium">Всё в порядке</span>
            <span className="block text-xs text-muted-foreground">
              Обязательное прочитано, страницы обновляются
            </span>
          </span>
        </div>
      ) : (
        <ul className="-mx-2 divide-y">
          {changed.map((r) => (
            <AttentionRow
              key={`changed-${r.pageId}`}
              index={index++}
              icon={RotateCcw}
              tone="warning"
              title={
                <>
                  <Link href={`/knowledge/${r.slug}`} className="transition-colors hover:text-brand">
                    {pageName(r.title)}
                  </Link>{" "}
                  изменена после прочтения
                </>
              }
              detail={`Прочитали прошлую версию: ${people(r.staleCount)}`}
              action={
                <KbReadingActions
                  pageId={r.pageId}
                  title={r.title}
                  remindCount={0}
                  staleCount={r.staleCount}
                  changedAfterRead
                  remindedAt={r.remindedAt}
                  showDismiss
                />
              }
            />
          ))}
          {unread.map((r) => (
            <AttentionRow
              key={`unread-${r.pageId}`}
              index={index++}
              icon={BookCheck}
              tone="info"
              title={
                <>
                  Не прочитали{" "}
                  <Link href={`/knowledge/${r.slug}/required-reading`} className="transition-colors hover:text-brand">
                    {pageName(r.title)}
                  </Link>
                </>
              }
              detail={`${r.unreadCount + r.rereadCount} из ${people(r.total)}`}
              action={
                <KbReadingActions
                  pageId={r.pageId}
                  title={r.title}
                  remindCount={r.remindCount}
                  staleCount={0}
                  changedAfterRead={false}
                  remindedAt={r.remindedAt}
                />
              }
            />
          ))}
          {staleCount > 0 && (
            <AttentionRow
              index={index++}
              icon={Clock}
              tone="neutral"
              title={`${countRu(staleCount, "страница не обновлялась", "страницы не обновлялись", "страниц не обновлялись")} полгода`}
              detail="Проверьте, не устарели ли регламенты"
              action={
                <Button asChild variant="outline" size="sm">
                  <Link href="/knowledge/overview?view=pages&sort=updated">Показать</Link>
                </Button>
              }
            />
          )}
        </ul>
      )}
    </HomeSection>
  );
}

function minutes(seconds: number): string {
  const min = Math.round(seconds / 60);
  return min < 1 ? "меньше минуты" : `${min} мин`;
}

/** «Популярное за период»: рейтинг страниц по времени чтения (как в «Допродажах»). */
export function KbOverviewPopular({ rows }: { rows: KbAnalyticsTopPage[] }) {
  const top = rows[0]?.total_seconds ?? 0;
  const sum = rows.reduce((acc, r) => acc + r.total_seconds, 0);
  return (
    <HomeSection title="Популярное за период">
      {rows.length === 0 ? (
        <p className="py-2 text-sm text-muted-foreground">За этот период страницы не читали</p>
      ) : (
        <ol className="divide-y">
          {rows.map((r, i) => (
            <li key={r.page_id} className="grid grid-cols-[24px_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1.5 py-3">
              <span
                aria-label={`${i + 1} место`}
                className={cn(
                  "flex size-6 items-center justify-center rounded-full text-xs tabular-nums",
                  i < 3 ? "bg-brand/10 font-semibold text-brand" : "text-muted-foreground",
                )}
              >
                {i + 1}
              </span>
              <Link
                href={`/knowledge/overview/${r.slug}`}
                className="flex min-w-0 items-center gap-2 text-sm transition-colors hover:text-brand"
              >
                <KbPageIcon icon={r.icon} color={r.icon_color} size={16} />
                <span className="truncate">{r.title.trim() || "Без названия"}</span>
              </Link>
              <span className="text-right">
                <span className="block text-sm font-medium tabular-nums">{minutes(r.total_seconds)}</span>
                <span className="block whitespace-nowrap text-xs text-muted-foreground">
                  {countRu(r.unique_viewers, "читатель", "читателя", "читателей")}
                </span>
              </span>
              <span className="col-start-2 col-end-4 flex items-center gap-3">
                <span className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-muted" aria-hidden>
                  <span
                    className={cn(
                      "chart-bar-grow-x block h-full rounded-full motion-reduce:![animation-delay:0ms]",
                      i < 3 ? "bg-brand" : "bg-brand/40",
                    )}
                    style={{
                      width: `${top > 0 ? (r.total_seconds / top) * 100 : 0}%`,
                      animationDelay: `${200 + Math.min(i, 12) * 90}ms`,
                    }}
                  />
                </span>
                <span className="w-12 shrink-0 text-right text-xs tabular-nums text-muted-foreground">
                  {sum > 0 ? Math.round((r.total_seconds / sum) * 100) : 0} %
                </span>
              </span>
            </li>
          ))}
        </ol>
      )}
    </HomeSection>
  );
}
