import { Skeleton } from "@/components/ui/skeleton";

/**
 * Строки-заглушки внутри секции панели, пока её данные грузятся: подпись
 * слева, значение справа. Секция стоит на своём месте сразу, и панель не
 * прыгает, когда данные приходят.
 */
export function SectionRowsSkeleton({
  label,
  rows = 3,
}: {
  /** Для экранного диктора: «Загружаем контроль кассы». */
  label: string;
  rows?: number;
}) {
  return (
    <div role="status" aria-label={label} aria-busy className="space-y-3">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex items-center justify-between gap-3">
          <Skeleton className={i % 2 ? "h-4 w-1/3" : "h-4 w-1/2"} />
          <Skeleton className="h-4 w-20" />
        </div>
      ))}
    </div>
  );
}

/** Заглушка ленты истории (`DrawerTimeline`): аватар 32px, заголовок и строка. */
export function TimelineSkeleton({
  label,
  rows = 3,
}: {
  label: string;
  rows?: number;
}) {
  return (
    <div role="status" aria-label={label} aria-busy className="space-y-4">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex gap-3">
          <Skeleton className="size-8 shrink-0 rounded-full" />
          <div className="min-w-0 flex-1 space-y-2 pt-1">
            <Skeleton className="h-4 w-1/2" />
            <Skeleton className="h-3 w-1/3" />
          </div>
        </div>
      ))}
    </div>
  );
}
