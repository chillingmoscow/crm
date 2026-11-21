import { PageFrame } from "@/components/shared/page-frame";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * Скелетон страниц «Продаж»: заголовок, строка периода с инструментами,
 * итоги и таблица — по форме экрана, чтобы он не прыгал после загрузки.
 */
export function SalesLoading({
  label,
  tabs = false,
  chart = false,
}: {
  label: string;
  /** Ряд вкладок над таблицей («Бар / Кальяны»). */
  tabs?: boolean;
  chart?: boolean;
}) {
  return (
    <PageFrame aria-label={label} aria-busy className="flex flex-col gap-4">
      <Skeleton className="h-10 w-56 max-w-full" />
      <div className="mt-1 flex flex-wrap items-center justify-between gap-3">
        <Skeleton className="h-9 w-48" />
        <div className="flex gap-2">
          <Skeleton className="size-9" />
          <Skeleton className="size-9" />
          <Skeleton className="size-9" />
          <Skeleton className="h-9 w-40" />
        </div>
      </div>
      {tabs && <Skeleton className="h-9 w-48" />}
      <Skeleton className="h-24 rounded-xl" />
      {chart && <Skeleton className="h-72 rounded-lg" />}
      <Skeleton className="h-80 rounded-lg" />
    </PageFrame>
  );
}
