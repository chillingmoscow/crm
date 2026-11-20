import { PageFrame, ProfilePageFrame } from "@/components/shared/page-frame";
import { Skeleton } from "@/components/ui/skeleton";

/** Скелетон списка раздела: заголовок с инструментами и таблица. */
export function CatalogListLoading({ label }: { label: string }) {
  return (
    <PageFrame aria-label={label} aria-busy className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <Skeleton className="h-10 w-64 max-w-full" />
        <div className="flex gap-2">
          <Skeleton className="size-9" />
          <Skeleton className="size-9" />
          <Skeleton className="size-9" />
          <Skeleton className="size-9" />
          <Skeleton className="h-9 w-40" />
        </div>
      </div>
      <Skeleton className="h-96 rounded-lg" />
    </PageFrame>
  );
}

/** Скелетон карточки позиции: фото и название, вкладки, секции «Обзора». */
export function CatalogCardLoading({ label }: { label: string }) {
  return (
    <ProfilePageFrame aria-label={label} aria-busy>
      <div className="flex min-w-0 items-center gap-4">
        <Skeleton className="size-14 shrink-0 rounded-[14px]" />
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <Skeleton className="h-8 w-56 max-w-full" />
          <Skeleton className="h-5 w-40 max-w-full" />
        </div>
      </div>
      <div className="flex justify-center gap-6 border-b pb-3">
        <Skeleton className="h-5 w-16" />
        <Skeleton className="h-5 w-24" />
        <Skeleton className="h-5 w-20" />
        <Skeleton className="h-5 w-16" />
      </div>
      <div className="flex flex-col gap-5">
        <Skeleton className="h-48 rounded-[14px]" />
        <Skeleton className="h-40 rounded-[14px]" />
      </div>
    </ProfilePageFrame>
  );
}
