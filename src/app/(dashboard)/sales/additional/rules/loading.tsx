import { ProfilePageFrame } from "@/components/shared/page-frame";
import { Skeleton } from "@/components/ui/skeleton";

/** Скелетон правил допродаж: шапка, вкладки подразделений и секции. */
export default function UpsellRulesLoading() {
  return (
    <ProfilePageFrame aria-label="Загружаем правила допродаж" aria-busy>
      <div className="flex items-center gap-4">
        <Skeleton className="size-14 rounded-[14px]" />
        <div className="space-y-2">
          <Skeleton className="h-8 w-56" />
          <Skeleton className="h-4 w-72" />
        </div>
      </div>
      <Skeleton className="h-10 w-full" />
      <Skeleton className="h-72 rounded-[14px]" />
      <Skeleton className="h-48 rounded-[14px]" />
    </ProfilePageFrame>
  );
}
