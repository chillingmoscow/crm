import { PageFrame } from "@/components/shared/page-frame";
import { Skeleton } from "@/components/ui/skeleton";

/** Скелетон списка гостей: заголовок с инструментами и таблица. */
export default function GuestsLoading() {
  return (
    <PageFrame aria-label="Загружаем гостей" aria-busy className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <Skeleton className="h-10 w-48 max-w-full" />
        <div className="flex gap-2">
          <Skeleton className="size-9" />
          <Skeleton className="size-9" />
          <Skeleton className="size-9" />
          <Skeleton className="size-9" />
          <Skeleton className="size-9" />
          <Skeleton className="h-9 w-40" />
        </div>
      </div>
      <Skeleton className="h-80 rounded-lg" />
    </PageFrame>
  );
}
