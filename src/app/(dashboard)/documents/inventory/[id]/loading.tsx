import { PageFrame } from "@/components/shared/page-frame";
import { Skeleton } from "@/components/ui/skeleton";

// Мгновенный скелетон при открытии акта: страница итогов/формы тяжёлая
// (много запросов), без него навигация выглядит «зависшей». Форма как у
// шапки карточки: плитка 56px, название, строка контекста, вкладки.
export default function Loading() {
  return (
    <PageFrame aria-label="Загружаем акт" aria-busy className="flex flex-col gap-6">
      <div className="mx-auto flex w-full max-w-[720px] flex-col gap-6">
        <div className="flex items-center gap-4">
          <Skeleton className="size-14 rounded-[14px]" />
          <div className="flex flex-col gap-2">
            <Skeleton className="h-8 w-56" />
            <Skeleton className="h-4 w-72 max-w-full" />
          </div>
        </div>
        <Skeleton className="h-10 w-full" />
      </div>
      <div className="flex flex-col gap-2">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-16 rounded-lg" />
        ))}
      </div>
    </PageFrame>
  );
}
