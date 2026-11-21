import { ProfilePageFrame } from "@/components/shared/page-frame";
import { Skeleton } from "@/components/ui/skeleton";

/** Скелетон настроек продаж: шапка карточки и секции. */
export default function SalesSettingsLoading() {
  return (
    <ProfilePageFrame aria-label="Загружаем настройки продаж" aria-busy>
      <div className="flex items-center gap-4">
        <Skeleton className="size-14 rounded-[14px]" />
        <div className="space-y-2">
          <Skeleton className="h-8 w-56" />
          <Skeleton className="h-4 w-32" />
        </div>
      </div>
      <Skeleton className="h-48 rounded-[14px]" />
      <Skeleton className="h-40 rounded-[14px]" />
      <Skeleton className="h-40 rounded-[14px]" />
    </ProfilePageFrame>
  );
}
