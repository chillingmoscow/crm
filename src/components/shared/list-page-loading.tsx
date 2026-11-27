import { PageFrame } from "@/components/shared/page-frame";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * Скелетон страницы-списка: заголовок, инструменты и таблица. Без него
 * переход по боковому меню ждал полного ответа сервера, и экран не менялся
 * до полусекунды и дольше.
 */
export function ListPageLoading({ label, tools = 3 }: { label: string; tools?: number }) {
  return (
    <PageFrame aria-label={label} aria-busy className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <Skeleton className="h-10 w-64 max-w-full" />
        <div className="flex gap-2">
          {Array.from({ length: tools }, (_, i) => (
            <Skeleton key={i} className="size-9" />
          ))}
          <Skeleton className="h-9 w-28" />
        </div>
      </div>
      <Skeleton className="h-96 rounded-lg" />
    </PageFrame>
  );
}
