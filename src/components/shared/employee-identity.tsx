"use client";

import { useState } from "react";

import { personInitials } from "@/lib/format/initials";
import { avatarImageUrl } from "@/lib/people/avatar-thumb";

/** Shared employee identity for payroll and sales. */
export function EmployeeIdentity({
  name,
  role,
  avatarUrl,
}: {
  name: string;
  role?: string | null;
  avatarUrl?: string | null;
}) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  return (
    <span className="flex min-w-0 items-center gap-3">
      <span className="flex size-9 shrink-0 items-center justify-center overflow-hidden rounded-full bg-muted text-xs font-medium text-muted-foreground">
        {avatarUrl && failedUrl !== avatarUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={avatarImageUrl(avatarUrl, 96)}
            alt=""
            className="size-full object-cover"
            onError={() => setFailedUrl(avatarUrl)}
          />
        ) : (
          personInitials(name)
        )}
      </span>
      <span className="flex min-w-0 flex-col gap-1">
        <span className="truncate text-[13px] font-medium leading-5">
          {name}
        </span>
        <span className="truncate text-[11px] font-normal leading-4 text-muted-foreground">
          {role || "Должность не указана"}
        </span>
      </span>
    </span>
  );
}
