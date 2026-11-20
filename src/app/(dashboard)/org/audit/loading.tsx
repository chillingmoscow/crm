import { PageFrame } from "@/components/shared/page-frame";
import { Skeleton } from "@/components/ui/skeleton";

/** Скелетон журнала: заголовок с инструментами и лента за два дня. */
export default function AuditLoading() {
  return (
    <PageFrame aria-label="Загружаем журнал событий" aria-busy className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <Skeleton className="h-10 w-72 max-w-full" />
        <div className="flex gap-2">
          <Skeleton className="size-9" />
          <Skeleton className="size-9" />
        </div>
      </div>
      {[5, 3].map((rows, group) => (
        <div key={group} className="space-y-2">
          <Skeleton className="h-4 w-24" />
          <div className="divide-y rounded-lg border bg-card">
            {Array.from({ length: rows }, (_, i) => (
              <div key={i} className="flex items-start gap-3 px-4 py-3">
                <Skeleton className="size-8 shrink-0 rounded-full" />
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-4 w-2/3 max-w-[480px]" />
                  <Skeleton className="h-3 w-16" />
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </PageFrame>
  );
}
