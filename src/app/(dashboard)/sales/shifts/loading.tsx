import { Skeleton } from "@/components/ui/skeleton";
export default function LoadingSalesShifts() {
  return (
    <div className="space-y-5 px-4 md:px-6" aria-label="Загружаем смены">
      <Skeleton className="h-9 w-36" />
      <Skeleton className="h-5 w-72" />
      <div className="flex justify-between">
        <Skeleton className="h-9 w-44" />
        <Skeleton className="h-9 w-56" />
      </div>
      <Skeleton className="h-24 w-full" />
      <Skeleton className="h-80 w-full" />
    </div>
  );
}
