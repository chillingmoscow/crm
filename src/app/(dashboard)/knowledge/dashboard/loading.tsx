import { Skeleton } from "@/components/ui/skeleton";

/**
 * Мгновенный скелетон дашборда БЗ. Сама страница — server component с
 * множеством аналитических RPC (summary / top pages / top users / trend /
 * audit / coverage) в Promise.all, и до их завершения контент-зона была
 * пустой — навигация выглядела «зависшей». loading.tsx даёт Suspense-границу:
 * каркас (сайдбар из layout + этот скелетон) показывается сразу, данные
 * подтягиваются стримингом. Структура зеркалит page.tsx (шапка → KPI-сетка
 * из 5 карточек → тренд → две секции).
 */
export default function Loading() {
  return (
    <div className="flex-1 flex flex-col">
      <div className="px-6 md:px-8 pt-4 pb-8 w-full">
        <div className="mx-auto w-full max-w-[1100px] flex flex-col gap-6">
          {/* Шапка: заголовок + описание + табы */}
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div className="space-y-2">
              <Skeleton className="h-7 w-40" />
              <Skeleton className="h-4 w-80 max-w-full" />
            </div>
            <div className="flex items-center gap-3">
              <Skeleton className="h-9 w-44 rounded-lg" />
              <Skeleton className="h-9 w-40 rounded-lg" />
            </div>
          </div>

          {/* KPI-сводка: 5 карточек */}
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
            {Array.from({ length: 5 }).map((_, i) => (
              <div
                key={i}
                className="flex flex-col gap-2 rounded-xl border bg-card p-4"
              >
                <Skeleton className="h-3.5 w-24" />
                <Skeleton className="h-7 w-16" />
                <Skeleton className="h-3 w-20" />
              </div>
            ))}
          </div>

          {/* График тренда */}
          <Skeleton className="h-44 w-full rounded-xl" />

          {/* Две секции: читаемые страницы + активные сотрудники */}
          <div className="grid gap-4 lg:grid-cols-[1fr_minmax(320px,420px)]">
            {Array.from({ length: 2 }).map((_, s) => (
              <section
                key={s}
                className="flex flex-col rounded-xl border bg-card overflow-hidden"
              >
                <div className="flex items-center justify-between border-b px-4 py-3.5">
                  <Skeleton className="h-4 w-40" />
                  <Skeleton className="h-3 w-16" />
                </div>
                <div className="flex flex-col gap-2 p-3">
                  {Array.from({ length: s === 0 ? 5 : 3 }).map((_, r) => (
                    <div key={r} className="flex items-center gap-3">
                      <Skeleton className="size-8 shrink-0 rounded-full" />
                      <div className="flex-1 space-y-1.5">
                        <Skeleton className="h-3.5 w-3/4" />
                        <Skeleton className="h-3 w-1/3" />
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
