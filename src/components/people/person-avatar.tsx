/* eslint-disable @next/next/no-img-element */
"use client";

import { useState, type ReactNode } from "react";
import { Lock } from "lucide-react";
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@/components/ui/hover-card";
import { cn } from "@/lib/utils";
import { personInitials } from "@/lib/format/initials";
import { avatarThumbUrl } from "@/lib/people/avatar-thumb";

/**
 * One photo treatment for people lists: circular crop, complete image on inspection.
 * `src` may be a resized copy; `previewSrc` is the larger copy for the hover card and
 * `fallbackSrc` the original, used when a resized copy fails to load.
 * A public original passed as `src` is shrunk automatically (`avatarThumbUrl`):
 * the circle loads a 96px copy, the hover card and a failed copy use the original.
 *
 * Метки на аватаре (DS → «Аватары и цвет»): `onShift` — зелёная точка
 * справа внизу «Сейчас на смене», `noAccount` — значок замка слева внизу
 * «Без аккаунта». У каждой своя подсказка. `flightId` — id сотрудника для
 * перелёта аватара в шапку карточки (`src/lib/people/avatar-flight.ts`).
 */
export function PersonAvatar({
  src: requestedSrc,
  previewSrc: requestedPreview,
  fallbackSrc,
  name,
  faded = false,
  onShift = false,
  noAccount = false,
  flightId,
}: {
  src?: string | null;
  previewSrc?: string | null;
  fallbackSrc?: string | null;
  name: string;
  faded?: boolean;
  /** Сейчас на смене: зелёная точка с подсказкой. */
  onShift?: boolean;
  /** У сотрудника нет аккаунта в Sheerly: значок замка с подсказкой. */
  noAccount?: boolean;
  /** id сотрудника: отсюда аватар перелетает в шапку его карточки. */
  flightId?: string;
}) {
  const [open, setOpen] = useState(false);
  const [failed, setFailed] = useState<ReadonlySet<string>>(() => new Set());
  const pick = (...urls: Array<string | null | undefined>) =>
    urls.find((url): url is string => !!url && !failed.has(url)) ?? null;
  const thumb = avatarThumbUrl(requestedSrc);
  const src = pick(thumb, requestedSrc, fallbackSrc);
  // Крупная копия для просмотра — тоже через оптимизатор (≤640px вместо
  // оригинала с телефона, и браузер держит её месяц).
  const previewSrc = pick(
    requestedPreview ?? avatarThumbUrl(requestedSrc, 640),
    fallbackSrc,
    requestedSrc,
    src,
  );
  const markFailed = (url: string) => setFailed((prev) => new Set(prev).add(url));
  const hasPhoto = !!src;
  const initial = personInitials(name);
  const fallback = (
    <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium text-muted-foreground">
      {initial}
    </span>
  );
  const marked = (circle: ReactNode) => (
    <AvatarMarks
      onShift={onShift}
      noAccount={noAccount}
      flightId={flightId}
    >
      {circle}
    </AvatarMarks>
  );
  if (!hasPhoto)
    return marked(
      <span className={cn("inline-flex", faded && "opacity-50")}>
        {fallback}
      </span>,
    );
  return marked(
    <HoverCard
      open={open}
      onOpenChange={setOpen}
      openDelay={150}
      closeDelay={80}
    >
      <HoverCardTrigger asChild>
        <button
          type="button"
          aria-label={`Увеличить фотографию: ${name}`}
          aria-expanded={open}
          onClick={(event) => {
            event.stopPropagation();
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setOpen(false)}
          className={cn(
            // Пока фото грузится, под ним видны те же инициалы на сером круге,
            // что и у людей без фото, — ячейка не выглядит пустой.
            "relative flex size-9 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium text-muted-foreground outline-none focus-visible:ring-2 focus-visible:ring-brand",
            faded && "opacity-50",
          )}
        >
          <span aria-hidden="true">{initial}</span>
          <img
            src={src!}
            alt=""
            width={36}
            height={36}
            className="absolute inset-0 size-9 rounded-full object-cover"
            loading="lazy"
            decoding="async"
            onError={() => {
              markFailed(src!);
              if (!fallbackSrc || src === fallbackSrc) setOpen(false);
            }}
          />
        </button>
      </HoverCardTrigger>
      <HoverCardContent
        side="bottom"
        align="start"
        collisionPadding={16}
        className="w-80 max-w-[calc(100vw-32px)] p-2"
      >
        <img
          src={previewSrc ?? src!}
          alt={`Фотография: ${name}`}
          onError={() => previewSrc && markFailed(previewSrc)}
          className="max-h-[60dvh] w-full rounded-md object-contain"
          width={300}
          height={360}
        />
      </HoverCardContent>
    </HoverCard>,
  );
}

/**
 * Обёртка аватара с метками. Метки — соседи круга, а не его дети: у
 * кнопки-фото своя подсказка (крупное фото), у метки — своя.
 */
function AvatarMarks({
  onShift,
  noAccount,
  flightId,
  children,
}: {
  onShift: boolean;
  noAccount: boolean;
  flightId?: string;
  children: ReactNode;
}) {
  if (!onShift && !noAccount && !flightId) return <>{children}</>;
  return (
    <span
      className="relative inline-flex shrink-0 rounded-full"
      data-avatar-flight-source={flightId}
    >
      {children}
      {noAccount && (
        <span
          role="img"
          aria-label="Без аккаунта"
          data-tip="Без аккаунта. Чтобы дать доступ, впишите email в карточке и отправьте приглашение"
          className="absolute -bottom-0.5 -left-0.5 flex size-4 items-center justify-center rounded-full bg-background text-muted-foreground ring-1 ring-border"
        >
          <Lock className="size-2.5" aria-hidden />
        </span>
      )}
      {onShift && (
        <span
          role="img"
          aria-label="Сейчас на смене"
          data-tip="Сейчас на смене"
          className="absolute -bottom-px -right-px size-3 rounded-full bg-green-500 ring-2 ring-background"
        />
      )}
    </span>
  );
}
