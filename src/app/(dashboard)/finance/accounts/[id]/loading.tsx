import { ProfilePageFrame } from "@/components/shared/page-frame";
import { Skeleton } from "@/components/ui/skeleton";

/** Скелетон карточки счёта: плитка и название, вкладки, секции. */
export default function BankAccountCardLoading() {
  return (
    <ProfilePageFrame aria-label="Загружаем счёт" aria-busy>
      <div className="flex min-w-0 items-center gap-4">
        <Skeleton className="size-14 shrink-0 rounded-[14px]" />
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <Skeleton className="h-8 w-56 max-w-full" />
          <Skeleton className="h-5 w-40 max-w-full" />
        </div>
      </div>
      <div className="flex justify-center gap-6 border-b pb-3">
        <Skeleton className="h-5 w-20" />
        <Skeleton className="h-5 w-16" />
      </div>
      <div className="flex flex-col gap-5">
        <Skeleton className="h-28 rounded-[14px]" />
        <Skeleton className="h-64 rounded-[14px]" />
      </div>
    </ProfilePageFrame>
  );
}
