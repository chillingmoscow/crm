import Image from "next/image";
import type { ReactNode } from "react";
import { Camera } from "lucide-react";
import { cn } from "@/lib/utils";
import { personInitials } from "@/lib/format/initials";

/**
 * Шапка карточки сущности: аватар 56px, имя 28px / 700, под ним серая
 * строка контекста и бейдж статуса.
 *
 * - `avatar` — своя плитка вместо фото (иконка должности, подразделения).
 * - `avatarEdit` — аватар становится кнопкой смены фото: значок камеры
 *   виден всегда и доступен с клавиатуры. Фото в карточке показывается
 *   только здесь.
 */
export function ProfileHeader({
  name,
  avatarUrl,
  avatar,
  avatarEdit,
  children,
  actions,
  wrapName = false,
}: {
  name: string;
  avatarUrl?: string | null;
  avatar?: ReactNode;
  avatarEdit?: { label: string; onClick: () => void };
  children?: ReactNode;
  actions?: ReactNode;
  wrapName?: boolean;
}) {
  const picture =
    avatar ??
    (avatarUrl ? (
      <Image
        unoptimized
        src={avatarUrl}
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
        {personInitials(name)}
      </div>
    ));
  return (
    <div className="flex min-w-0 flex-wrap items-start justify-between gap-4">
      <div
        className={cn("flex min-w-0 items-center gap-4", actions && "flex-[1_1_360px]")}
      >
        {avatarEdit ? (
          <button
            type="button"
            onClick={avatarEdit.onClick}
            aria-label={avatarEdit.label}
            data-tip={avatarEdit.label}
            className="group relative shrink-0 rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {picture}
            <span
              aria-hidden
              className="absolute -bottom-0.5 -right-0.5 flex size-6 items-center justify-center rounded-full border bg-background text-muted-foreground shadow-sm transition-colors group-hover:text-foreground"
            >
              <Camera className="size-3.5" />
            </span>
          </button>
        ) : (
          <div className="relative shrink-0">{picture}</div>
        )}
        <div className="flex min-w-0 flex-col gap-2">
          <h1
            className={cn(
              "text-[28px] font-bold leading-tight tracking-tight",
              wrapName ? "break-words" : "truncate",
            )}
          >
            {name}
          </h1>
          {children ? (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
              {children}
            </div>
          ) : null}
        </div>
      </div>
      {actions && (
        <div className="flex max-w-full shrink-0 flex-wrap gap-2">{actions}</div>
      )}
    </div>
  );
}
