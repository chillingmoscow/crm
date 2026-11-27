import { PageFrame } from "@/components/shared/page-frame";
import { Skeleton } from "@/components/ui/skeleton";

/** Скелетон служебной страницы базы знаний: шапка 36px и блоки. */
export function KbSectionLoading({ label }: { label: string }) {
  return (
    <PageFrame aria-label={label} aria-busy className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <Skeleton className="h-10 w-56 max-w-full" />
        <Skeleton className="h-9 w-36" />
      </div>
      <Skeleton className="h-32 rounded-lg" />
      <div className="grid gap-4 lg:grid-cols-2">
        <Skeleton className="h-56 rounded-lg" />
        <Skeleton className="h-56 rounded-lg" />
      </div>
    </PageFrame>
  );
}

/** Скелетон документа: значок, заголовок и строки текста в колонке 720. */
export function KbDocumentLoading() {
  return (
    <PageFrame aria-label="Открываем страницу" aria-busy>
      <div className="mx-auto flex w-full max-w-[720px] flex-col gap-4">
        <Skeleton className="size-11 rounded-lg" />
        <Skeleton className="h-10 w-2/3" />
        <div className="mt-4 flex flex-col gap-3">
          {[92, 100, 84, 96, 60].map((w, i) => (
            <Skeleton key={i} className="h-4" style={{ width: `${w}%` }} />
          ))}
        </div>
      </div>
    </PageFrame>
  );
}
