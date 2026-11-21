import { PageFrame } from "@/components/shared/page-frame";
import { Skeleton } from "@/components/ui/skeleton";

/** Скелетон очереди «На разбор»: заголовок со стрелками и одна карточка платежа. */
export default function InboxLoading() {
  return (
    <PageFrame aria-label="Загружаем платежи на разбор" aria-busy className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <Skeleton className="h-10 w-56 max-w-full" />
        <Skeleton className="h-9 w-40" />
      </div>
      <Skeleton className="h-[420px] max-w-[720px] rounded-lg" />
    </PageFrame>
  );
}
