import { ProfilePageFrame } from "@/components/shared/page-frame";
import { Skeleton } from "@/components/ui/skeleton";

/** Integration screen skeleton: logo and name, then sections (same column as the page). */
export function IntegrationPageSkeleton() {
  return <ProfilePageFrame aria-label="Загружаем интеграцию" aria-busy>
    <div className="flex min-w-0 items-center gap-4">
      <Skeleton className="size-14 shrink-0 rounded-[14px]" />
      <div className="flex min-w-0 flex-1 flex-col gap-2"><Skeleton className="h-8 w-48 max-w-full" /><Skeleton className="h-5 w-40 max-w-full" /></div>
    </div>
    <Skeleton className="h-40 rounded-[14px]" />
    <Skeleton className="h-56 rounded-[14px]" />
  </ProfilePageFrame>;
}
