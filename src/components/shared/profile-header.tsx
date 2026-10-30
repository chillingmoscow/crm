import Image from "next/image";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/** Shared identity header for staff and candidate profiles. */
export function ProfileHeader({
  name,
  avatarUrl,
  children,
  actions,
  wrapName = false,
}: {
  name: string;
  avatarUrl?: string | null;
  children: ReactNode;
  actions?: ReactNode;
  wrapName?: boolean;
}) {
  return (
    <div className="flex min-w-0 flex-wrap items-start justify-between gap-4">
      <div
        className={cn("flex min-w-0 items-center gap-4", actions && "flex-[1_1_360px]")}
      >
        <div className="relative shrink-0">
          {avatarUrl ? (
            <Image
              unoptimized
              src={avatarUrl}
              alt={name}
              width={56}
              height={56}
              className="h-14 w-14 rounded-full bg-muted object-cover"
            />
          ) : (
            <div className="flex h-14 w-14 items-center justify-center rounded-full bg-muted text-xl font-semibold text-muted-foreground">
              {name.charAt(0).toUpperCase()}
            </div>
          )}
        </div>
        <div className="flex min-w-0 flex-col gap-2">
          <h1
            className={cn(
              "text-[28px] font-bold leading-tight tracking-tight",
              wrapName ? "break-words" : "truncate",
            )}
          >
            {name}
          </h1>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            {children}
          </div>
        </div>
      </div>
      {actions && (
        <div className="flex max-w-full shrink-0 flex-wrap gap-2">{actions}</div>
      )}
    </div>
  );
}
