"use client";

import { useState } from "react";

import { KbPageIcon } from "@/components/knowledge/kb-page-icon";
import { KbIconPickerBody } from "@/components/knowledge/kb-icon-picker";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import type {
  KbCollectionField,
  KbCollectionViewIcon,
} from "@/lib/knowledge/collection";

import { FIELD_ICONS, stopBlockInteraction } from "./shared";

export function CollectionViewIconPicker({
  value,
  onChange,
}: {
  value: KbCollectionViewIcon;
  onChange: (icon: KbCollectionViewIcon) => void;
}) {
  const [open, setOpen] = useState(false);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="kb-collection-view-icon-picker"
          aria-label="Изменить иконку вида"
          onPointerDown={stopBlockInteraction}
          onMouseDown={stopBlockInteraction}
          onClick={stopBlockInteraction}
        >
          <KbPageIcon icon={value} color={null} size={18} />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        sideOffset={6}
        className="w-[380px] p-0 rounded-[10px]"
        onPointerDown={stopBlockInteraction}
        onMouseDown={stopBlockInteraction}
        onClick={stopBlockInteraction}
        onOpenAutoFocus={(event) => event.preventDefault()}
      >
        <KbIconPickerBody
          value={value}
          color={null}
          onChange={(next) => onChange(next.icon ?? "database")}
          onCommitClose={() => setOpen(false)}
        />
      </PopoverContent>
    </Popover>
  );
}

export function CollectionFieldIconPicker({
  field,
  onChange,
}: {
  field: KbCollectionField;
  onChange: (patch: Partial<KbCollectionField>) => void;
}) {
  const [open, setOpen] = useState(false);
  const FallbackIcon = FIELD_ICONS[field.type];

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="kb-collection-view-icon-picker"
          aria-label="Изменить иконку свойства"
          onPointerDown={stopBlockInteraction}
          onMouseDown={stopBlockInteraction}
          onClick={stopBlockInteraction}
        >
          {field.icon ? (
            <KbPageIcon
              icon={field.icon}
              color={field.iconColor ?? null}
              size={18}
            />
          ) : (
            <FallbackIcon className="size-4 text-muted-foreground" />
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        sideOffset={6}
        className="w-[380px] p-0 rounded-[10px]"
        onPointerDown={stopBlockInteraction}
        onMouseDown={stopBlockInteraction}
        onClick={stopBlockInteraction}
        onOpenAutoFocus={(event) => event.preventDefault()}
      >
        <KbIconPickerBody
          value={field.icon ?? null}
          color={field.iconColor ?? null}
          onChange={(next) =>
            onChange({
              icon: next.icon ?? undefined,
              iconColor: next.color ?? undefined,
            })
          }
          onCommitClose={() => setOpen(false)}
        />
      </PopoverContent>
    </Popover>
  );
}
