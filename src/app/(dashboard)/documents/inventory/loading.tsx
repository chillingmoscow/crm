import { PageFrame } from "@/components/shared/page-frame";
import { Skeleton } from "@/components/ui/skeleton";

/** Скелетон списка актов: заголовок с инструментами и таблица. */
export default function InventoryDocumentsLoading() {
  return (
    <PageFrame aria-label="Загружаем акты инвентаризации" aria-busy className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <Skeleton className="h-10 w-80 max-w-full" />
        <div className="flex gap-2">
          <Skeleton className="size-9" />
          <Skeleton className="size-9" />
          <Skeleton className="size-9" />
          <Skeleton className="size-9" />
          <Skeleton className="h-9 w-44" />
        </div>
      </div>
      <Skeleton className="h-96 rounded-lg" />
    </PageFrame>
  );
}
