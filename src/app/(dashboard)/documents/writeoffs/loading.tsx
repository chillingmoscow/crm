import { PageFrame } from "@/components/shared/page-frame";
import { Skeleton } from "@/components/ui/skeleton";

/** Скелетон по форме страницы: заголовок, строка периода, показатели, таблица. */
export default function Loading() {
  return (
    <PageFrame
      className="space-y-4"
      role="status"
      aria-label="Загружаем списания"
      aria-busy
    >
      <div className="flex flex-col gap-5">
        <Skeleton className="h-10 w-56" />
        <div className="flex min-h-9 flex-wrap items-center justify-between gap-3">
          <Skeleton className="h-9 w-48 rounded-lg" />
          <div className="flex gap-2">
            {Array.from({ length: 5 }, (_, i) => (
              <Skeleton key={i} className="size-9" />
            ))}
          </div>
        </div>
      </div>
      <Skeleton className="h-24 rounded-xl" />
      <div className="rounded-lg border bg-card">
        <Skeleton className="h-11 rounded-b-none rounded-t-lg" />
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} className="flex h-[60px] items-center gap-4 border-t px-3">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-4 flex-1" />
            <Skeleton className="h-4 w-20" />
          </div>
        ))}
      </div>
    </PageFrame>
  );
}
