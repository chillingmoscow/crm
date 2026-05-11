"use client";

import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

import { cn } from "@/lib/utils";
import type { KbGalleryItem } from "@/lib/knowledge/gallery";

import { GalleryImageMenu } from "./image-menu";
import { GalleryResolvedImage } from "./resolved-image";

type SortableListeners = NonNullable<
  ReturnType<typeof useSortable>["listeners"]
>;

export function getPointerSortableListeners(
  listeners: ReturnType<typeof useSortable>["listeners"],
): Omit<SortableListeners, "onKeyDown"> {
  const pointerListeners = { ...(listeners ?? ({} as SortableListeners)) };
  delete pointerListeners.onKeyDown;
  return pointerListeners;
}

export function SortableGalleryItem({
  item,
  editable,
  showCaptions,
  onOpen,
  onUpdateCaption,
  onReplace,
  onReplaceUrl,
  onRemove,
  onOpenOriginal,
  onPointerSettled,
}: {
  item: KbGalleryItem;
  editable: boolean;
  showCaptions: boolean;
  onOpen: () => void;
  onUpdateCaption: (caption: string) => void;
  onReplace: (file: File) => void;
  onReplaceUrl: (url: string) => void;
  onRemove: () => void;
  onOpenOriginal: () => void;
  onPointerSettled: () => void;
}) {
  const sortable = useSortable({ id: item.id, disabled: !editable });
  const dragListeners = getPointerSortableListeners(sortable.listeners);
  const style = {
    transform: CSS.Transform.toString(sortable.transform),
    transition: sortable.transition,
  };

  return (
    <article
      ref={sortable.setNodeRef}
      style={style}
      className={cn(
        "kb-gallery-item",
        sortable.isDragging && "is-dragging",
      )}
      {...sortable.attributes}
      {...dragListeners}
      onPointerUp={onPointerSettled}
    >
      <button
        type="button"
        className="kb-gallery-image-btn"
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          onOpen();
        }}
        onKeyDown={(event) => {
          if (event.key !== "Enter" && event.key !== " ") return;
          event.preventDefault();
          event.stopPropagation();
          onOpen();
        }}
      >
        <GalleryResolvedImage item={item} variant="thumb" />
      </button>
      {editable && (
        <div className="kb-gallery-item-actions" contentEditable={false}>
          <GalleryImageMenu
            item={item}
            onUpdateCaption={onUpdateCaption}
            onReplace={onReplace}
            onReplaceUrl={onReplaceUrl}
            onRemove={onRemove}
            onOpenOriginal={onOpenOriginal}
          />
        </div>
      )}
      {showCaptions ? (
        <div
          className="kb-gallery-caption"
          data-empty={!item.caption || undefined}
        >
          {item.caption || "\u00A0"}
        </div>
      ) : null}
    </article>
  );
}
