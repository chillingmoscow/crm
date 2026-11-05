/* eslint-disable @next/next/no-img-element */
"use client";

import { useState } from "react";
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@/components/ui/hover-card";
import { cn } from "@/lib/utils";

/**
 * One photo treatment for people lists: circular crop, complete image on inspection.
 * `src` may be a resized copy; `previewSrc` is the larger copy for the hover card and
 * `fallbackSrc` the original, used when a resized copy fails to load.
 */
export function PersonAvatar({
  src: requestedSrc,
  previewSrc: requestedPreview,
  fallbackSrc,
  name,
  faded = false,
}: {
  src?: string | null;
  previewSrc?: string | null;
  fallbackSrc?: string | null;
  name: string;
  faded?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [failed, setFailed] = useState<ReadonlySet<string>>(() => new Set());
  const pick = (...urls: Array<string | null | undefined>) =>
    urls.find((url): url is string => !!url && !failed.has(url)) ?? null;
  const src = pick(requestedSrc, fallbackSrc);
  const previewSrc = pick(requestedPreview, fallbackSrc, src);
  const markFailed = (url: string) => setFailed((prev) => new Set(prev).add(url));
  const hasPhoto = !!src;
  const fallback = (
    <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium text-muted-foreground">
      {name.trim().charAt(0).toUpperCase() || "?"}
    </span>
  );
  if (!hasPhoto)
    return (
      <span className={cn("inline-flex", faded && "opacity-50")}>
        {fallback}
      </span>
    );
  return (
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
            "block size-9 shrink-0 rounded-full outline-none focus-visible:ring-2 focus-visible:ring-brand",
            faded && "opacity-50",
          )}
        >
          <img
            src={src!}
            alt=""
            width={36}
            height={36}
            className="size-9 rounded-full object-cover"
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
    </HoverCard>
  );
}
