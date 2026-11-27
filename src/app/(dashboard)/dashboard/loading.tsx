import { PageFrame } from "@/components/shared/page-frame";
import { Skeleton } from "@/components/ui/skeleton";

/** Скелетон главной: строка приветствия, полоса показателей и два столбца блоков. */
export default function HomeLoading() {
  return (
    <PageFrame aria-label="Загружаем главную" aria-busy className="flex flex-col gap-6">
      <Skeleton className="h-10 w-full max-w-[520px]" />
      <Skeleton className="h-[118px] rounded-xl" />
      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <Skeleton className="h-72 rounded-lg" />
        <Skeleton className="h-56 rounded-lg" />
      </div>
    </PageFrame>
  );
}
