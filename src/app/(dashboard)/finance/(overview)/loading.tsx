import { PageFrame } from "@/components/shared/page-frame";
import { Skeleton } from "@/components/ui/skeleton";

/** Скелетон дашборда финансов: шапка с периодом, полоса итогов и блоки. */
export default function FinanceDashboardLoading() {
  return (
    <PageFrame aria-label="Загружаем дашборд" aria-busy className="space-y-4">
      <Skeleton className="h-10 w-48 max-w-full" />
      <div className="flex flex-wrap items-center gap-2 pt-1">
        <Skeleton className="h-9 w-56 rounded-lg" />
        <Skeleton className="h-9 w-24" />
      </div>
      <div className="space-y-6 pt-2">
        <Skeleton className="h-[118px] rounded-xl" />
        <div className="grid gap-6 lg:grid-cols-2">
          <Skeleton className="h-80 rounded-lg" />
          <Skeleton className="h-80 rounded-lg" />
        </div>
        <Skeleton className="h-96 rounded-lg" />
      </div>
    </PageFrame>
  );
}
