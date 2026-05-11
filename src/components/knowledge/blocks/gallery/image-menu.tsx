"use client";

import { useState } from "react";

import {
  ExternalLink,
  MoreHorizontal,
  Pencil,
  RefreshCw,
  Trash2,
} from "lucide-react";

import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import type { KbGalleryItem } from "@/lib/knowledge/gallery";

import { GalleryCaptionPopoverForm } from "./caption-popover";
import { GalleryImagePicker } from "./image-picker";
import { stopBlockInteraction, stopBlockMenuAction } from "./shared";

export function GalleryImageMenu({
  item,
  onUpdateCaption,
  onReplace,
  onReplaceUrl,
  onRemove,
  onOpenOriginal,
}: {
  item: KbGalleryItem;
  onUpdateCaption: (caption: string) => void;
  onReplace: (file: File) => void;
  onReplaceUrl: (url: string) => void;
  onRemove: () => void;
  onOpenOriginal: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [replaceOpen, setReplaceOpen] = useState(false);
  const [captionOpen, setCaptionOpen] = useState(false);

  return (
    <Popover
      open={open}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen);
        if (!nextOpen) {
          setReplaceOpen(false);
          setCaptionOpen(false);
        }
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          className="kb-gallery-item-action"
          aria-label="Открыть меню изображения"
          onPointerDown={stopBlockInteraction}
          onMouseDown={stopBlockInteraction}
          onClick={stopBlockInteraction}
        >
          <MoreHorizontal className="size-4" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        sideOffset={6}
        className={cn(
          "kb-gallery-popover-menu",
          replaceOpen || captionOpen
            ? "w-auto p-0 border-0 bg-transparent shadow-none"
            : "w-52",
        )}
        onPointerDown={stopBlockInteraction}
        onMouseDown={stopBlockInteraction}
        onClick={stopBlockInteraction}
        onOpenAutoFocus={(event) => event.preventDefault()}
      >
        {replaceOpen ? (
          <GalleryImagePicker
            canUpload
            mode="replace"
            multiple={false}
            onFiles={(files) => {
              const file = files[0];
              if (file) onReplace(file);
              setReplaceOpen(false);
              setOpen(false);
            }}
            onUrls={(urls) => {
              const url = urls[0];
              if (url) onReplaceUrl(url);
              setReplaceOpen(false);
              setOpen(false);
            }}
          />
        ) : captionOpen ? (
          <GalleryCaptionPopoverForm
            initialValue={item.caption ?? ""}
            onCancel={() => setCaptionOpen(false)}
            onSubmit={(caption) => {
              onUpdateCaption(caption);
              setCaptionOpen(false);
              setOpen(false);
            }}
          />
        ) : (
          <>
            <button
              type="button"
              className="kb-gallery-menu-item"
              onClick={(event) => {
                stopBlockMenuAction(event);
                setCaptionOpen(true);
              }}
            >
              <Pencil className="mr-2 size-4" />
              {item.caption ? "Изменить подпись" : "Добавить подпись"}
            </button>
            <button
              type="button"
              className="kb-gallery-menu-item"
              onClick={(event) => {
                stopBlockMenuAction(event);
                setReplaceOpen(true);
              }}
            >
              <RefreshCw className="mr-2 size-4" />
              Заменить
            </button>
            <button
              type="button"
              className="kb-gallery-menu-item"
              onClick={(event) => {
                stopBlockMenuAction(event);
                setOpen(false);
                onOpenOriginal();
              }}
            >
              <ExternalLink className="mr-2 size-4" />
              Показать оригинал
            </button>
            <button
              type="button"
              className="kb-gallery-menu-item is-destructive"
              onClick={(event) => {
                stopBlockMenuAction(event);
                setOpen(false);
                onRemove();
              }}
            >
              <Trash2 className="mr-2 size-4" />
              Удалить
            </button>
          </>
        )}
      </PopoverContent>
    </Popover>
  );
}
