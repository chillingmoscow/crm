import { PageFrame } from "@/components/shared/page-frame";
import { Skeleton } from "@/components/ui/skeleton";

/** Скелетон приходных накладных: заголовок, строка периода, итоги и таблица. */
export default function SuppliesLoading() {
  return (
    <PageFrame aria-label="Загружаем приходные накладные" aria-busy className="flex flex-col gap-4">
      <Skeleton className="h-10 w-72 max-w-full" />
      <div className="mt-1 flex flex-wrap items-center justify-between gap-3">
        <Skeleton className="h-9 w-48" />
        <div className="flex gap-2">
          <Skeleton className="size-9" />
          <Skeleton className="size-9" />
          <Skeleton className="size-9" />
          <Skeleton className="size-9" />
          <Skeleton className="h-9 w-44" />
        </div>
      </div>
      <Skeleton className="h-24 rounded-xl" />
      <Skeleton className="h-80 rounded-lg" />
    </PageFrame>
  );
}
