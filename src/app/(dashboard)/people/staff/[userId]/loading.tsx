import { ProfilePageFrame } from "@/components/shared/page-frame";
import { Skeleton } from "@/components/ui/skeleton";
import { StaffCardLoadingHeader } from "./_components/staff-card-loading-header";

/** Скелетон карточки сотрудника: шапка, вкладки и секции «Основного». */
export default function StaffCardLoading() {
  return (
    <ProfilePageFrame aria-label="Загружаем карточку сотрудника" aria-busy>
      <StaffCardLoadingHeader />
      <div className="flex justify-center gap-6 border-b pb-3">
        <Skeleton className="h-5 w-20" />
        <Skeleton className="h-5 w-20" />
        <Skeleton className="h-5 w-16" />
        <Skeleton className="hidden h-5 w-16 sm:block" />
      </div>
      <div className="flex flex-col gap-5">
        <Skeleton className="h-64 rounded-[14px]" />
        <Skeleton className="h-48 rounded-[14px]" />
        <Skeleton className="h-40 rounded-[14px]" />
      </div>
    </ProfilePageFrame>
  );
}
