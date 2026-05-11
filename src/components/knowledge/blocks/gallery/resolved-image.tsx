"use client";

import { useState } from "react";

import { Image as ImageIcon } from "lucide-react";
import { useResolveUrl } from "@blocknote/react";

import { cn } from "@/lib/utils";
import type { KbGalleryItem } from "@/lib/knowledge/gallery";
import { useCachedImagePreviewUrl } from "@/lib/knowledge/use-image-preview-cache";

import { KB_FILE_SCHEME } from "./shared";

export function GalleryResolvedImage({
  item,
  variant,
}: {
  item: KbGalleryItem;
  variant: "thumb" | "lightbox";
}) {
  const [failed, setFailed] = useState(false);
  const resolved = useResolveUrl(item.url);
  const storagePath = item.url.startsWith(KB_FILE_SCHEME)
    ? item.url.slice(KB_FILE_SCHEME.length)
    : null;
  const sourceUrl =
    resolved.loadingState === "loading" ? null : (resolved.downloadUrl ?? null);
  const preview = useCachedImagePreviewUrl({
    storagePath,
    sourceUrl,
  });

  const src =
    storagePath && preview.url
      ? preview.url
      : sourceUrl
        ? sourceUrl
        : resolved.loadingState === "loading" && storagePath
          ? null
          : item.url;

  if (failed) {
    return (
      <div className="kb-gallery-image-fallback">
        <ImageIcon className="size-6" strokeWidth={1.5} />
      </div>
    );
  }

  if (!src) {
    return <div className="kb-gallery-image-loading" aria-hidden />;
  }

  return (
    // Blob/signed URLs are editor-local and not compatible with next/image.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      className={cn(
        "kb-gallery-image",
        variant === "lightbox" && "kb-gallery-image-lightbox",
      )}
      src={src}
      alt={item.alt || item.caption || item.name || "Gallery image"}
      loading={variant === "thumb" ? "lazy" : "eager"}
      decoding="async"
      draggable={false}
      onError={() => setFailed(true)}
    />
  );
}
