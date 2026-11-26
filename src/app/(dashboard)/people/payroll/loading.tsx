import { PageFrame } from "@/components/shared/page-frame";
import { Skeleton } from "@/components/ui/skeleton";

/** Скелетон зарплаты: месяц и инструменты, полоса итогов, вкладки, график и ведомость. */
export default function PayrollLoading() {
  return (
    <PageFrame aria-label="Загружаем зарплату" aria-busy className="space-y-4">
      <Skeleton className="h-10 w-48 max-w-full" />
      <div className="flex flex-wrap items-center justify-between gap-4">
        <Skeleton className="h-9 w-44 rounded-lg" />
        <div className="flex gap-2">
          <Skeleton className="size-9" />
          <Skeleton className="size-9" />
          <Skeleton className="size-9" />
          <Skeleton className="size-9" />
          <Skeleton className="h-9 w-28" />
        </div>
      </div>
      <Skeleton className="h-[118px] rounded-xl" />
      <Skeleton className="h-9 w-80 max-w-full" />
      <Skeleton className="h-72 rounded-lg" />
      <Skeleton className="h-96 rounded-lg" />
    </PageFrame>
  );
}
