"use client";

/* eslint-disable @next/next/no-img-element */
import { usePathname } from "next/navigation";
import { Skeleton } from "@/components/ui/skeleton";
import { personInitials } from "@/lib/format/initials";
import { avatarImageUrl } from "@/lib/people/avatar-thumb";
import { flightTargetStyle, pendingFlight } from "@/lib/people/avatar-flight";

/**
 * Шапка скелетона карточки сотрудника. Если в карточку перешли из списка с
 * перелётом аватара, фото и имя уже известны: рисуем их сразу на месте
 * будущей шапки (та же разметка, что `ProfileHeader`), и аватар садится сюда
 * без паузы на запрос. Иначе — серые плашки.
 */
export function StaffCardLoadingHeader() {
  const userId = usePathname().split("/")[3] ?? null;
  const flight = pendingFlight(userId);
  if (!flight)
    return (
      <div className="flex min-w-0 items-center gap-4">
        <Skeleton className="size-14 shrink-0 rounded-full" />
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <Skeleton className="h-8 w-56 max-w-full" />
          <Skeleton className="h-5 w-40 max-w-full" />
        </div>
      </div>
    );
  return (
    <div className="flex min-w-0 items-center gap-4">
      <div
        className="shrink-0 rounded-full"
        style={flightTargetStyle(flight.userId)}
        data-avatar-flight-target={flight.userId}
      >
        {flight.src ? (
          <img
            src={avatarImageUrl(flight.src, 128)}
            alt=""
            width={56}
            height={56}
            className="h-14 w-14 rounded-full bg-muted object-cover"
          />
        ) : (
          <div
            aria-hidden
            className="flex h-14 w-14 items-center justify-center rounded-full bg-muted text-xl font-semibold text-muted-foreground"
          >
            {personInitials(flight.name)}
          </div>
        )}
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <p className="break-words text-[28px] font-bold leading-tight tracking-tight">
          {flight.name}
        </p>
        <Skeleton className="h-5 w-40 max-w-full" />
      </div>
    </div>
  );
}
