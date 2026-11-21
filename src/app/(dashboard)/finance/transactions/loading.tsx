import { PageFrame } from "@/components/shared/page-frame";
import { Skeleton } from "@/components/ui/skeleton";

/** Скелетон списка операций: заголовок с инструментами и таблица. */
export default function TransactionsLoading() {
  return (
    <PageFrame aria-label="Загружаем операции" aria-busy className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <Skeleton className="h-10 w-56 max-w-full" />
        <div className="flex gap-2">
          <Skeleton className="size-9" />
          <Skeleton className="size-9" />
          <Skeleton className="size-9" />
          <Skeleton className="size-9" />
          <Skeleton className="size-9" />
          <Skeleton className="h-9 w-48" />
        </div>
      </div>
      <Skeleton className="h-96 rounded-lg" />
    </PageFrame>
  );
}
