import { PageFrame } from "@/components/shared/page-frame";
import { Skeleton } from "@/components/ui/skeleton";

/** Скелетон расписания: заголовок с периодом и инструментами, сетка недели. */
export default function Loading() {
  return (
    <PageFrame aria-label="Загружаем расписание" aria-busy className="space-y-6">
      <Skeleton className="h-4 w-48" />
      <div className="flex flex-wrap items-center justify-between gap-4">
        <Skeleton className="h-10 w-64 max-w-full" />
        <div className="flex gap-2">
          <Skeleton className="size-9" />
          <Skeleton className="size-9" />
          <Skeleton className="size-9" />
          <Skeleton className="h-9 w-28" />
        </div>
      </div>
      <Skeleton className="h-[480px] rounded-lg" />
    </PageFrame>
  );
}
