import { PageFrame } from "@/components/shared/page-frame";
import { Skeleton } from "@/components/ui/skeleton";

/** Скелетон списка: заголовок с инструментами и таблица. */
export default function OrgLegalEntitiesArchiveLoading() {
  return (
    <PageFrame aria-label="Загружаем архив юрлиц" aria-busy className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <Skeleton className="h-10 w-64 max-w-full" />
        <div className="flex gap-2">
          <Skeleton className="size-9" />
          <Skeleton className="size-9" />
          <Skeleton className="size-9" />
          <Skeleton className="h-9 w-36" />
        </div>
      </div>
      <Skeleton className="h-80 rounded-lg" />
    </PageFrame>
  );
}
