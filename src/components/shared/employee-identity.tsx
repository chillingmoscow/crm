"use client";

import { useState } from "react";

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
      <span className="flex size-9 shrink-0 items-center justify-center overflow-hidden rounded-full bg-brand/10 text-xs font-medium text-brand">
        {avatarUrl && failedUrl !== avatarUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={avatarUrl}
            alt=""
            className="size-full object-cover"
            onError={() => setFailedUrl(avatarUrl)}
          />
        ) : (
          name
            .trim()
            .split(/\s+/)
            .slice(0, 2)
            .map((word) => word[0])
            .join("")
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
