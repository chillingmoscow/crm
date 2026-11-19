import { PageFrame } from "@/components/shared/page-frame";
import { Skeleton } from "@/components/ui/skeleton";

/** Скелетон списка подразделений: заголовок с инструментами и таблица. */
export default function DepartmentsLoading() {
  return (
    <PageFrame aria-label="Загружаем подразделения" aria-busy className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <Skeleton className="h-10 w-64 max-w-full" />
        <div className="flex gap-2">
          <Skeleton className="size-9" />
          <Skeleton className="size-9" />
          <Skeleton className="size-9" />
          <Skeleton className="h-9 w-28" />
        </div>
      </div>
      <Skeleton className="h-80 rounded-lg" />
    </PageFrame>
  );
}
