"use client";

import { useState } from "react";

import { KbPageIcon } from "@/components/knowledge/kb-page-icon";
import { KbIconPickerBody } from "@/components/knowledge/kb-icon-picker";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import type { KbProperty } from "@/types/knowledge";

import { TYPE_ICONS } from "../helpers";

/** Inline icon-trigger перед именем property. По дефолту показывает
 *  TYPE_ICONS[type] (default behavior до Stage 2). Если у property
 *  есть `icon` override — рендерится оно (Lucide-name из KB_ICONS) с
 *  опциональным `iconColor` тинтом. Click открывает Popover с
 *  `KbIconPickerBody` — тот же компонент, что у KB-страничного picker'а:
 *  search + Random + color popover (10 цветов) + крестик «Отменить выбор».
 *
 *  Read-only режим (`!canEdit`): trigger некликабельный, выглядит как
 *  обычная иконка без интерактивности.
 *
 *  Триггер у property маленький (20px) и fallback другой (TYPE_ICONS[type],
 *  не File), поэтому не используем `<KbIconPicker>` целиком — только
 *  его popover-body. */
export function PropertyIconButton({
  property,
  canEdit,
  onChangeIcon,
}: {
  property: KbProperty;
  canEdit: boolean;
  onChangeIcon: (icon: string | null, iconColor: string | null) => void;
}) {
  const [open, setOpen] = useState(false);

  const TypeFallback = TYPE_ICONS[property.type];
  const hasOverride = Boolean(property.icon);

  // Render-helper: если override есть — KbPageIcon (рендерит из KB_ICONS
  // с тинтом). Иначе TYPE_ICONS[type] (Lucide дефолт).
  const renderIcon = (size: number) =>
    hasOverride ? (
      <KbPageIcon
        icon={property.icon ?? null}
        color={property.iconColor ?? null}
        size={size}
      />
    ) : (
      <TypeFallback className="size-3.5 text-muted-foreground/70" />
    );

  if (!canEdit) {
    return (
      <span className="size-5 shrink-0 inline-flex items-center justify-center">
        {renderIcon(14)}
      </span>
    );
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label="Изменить иконку свойства"
          className="size-5 shrink-0 inline-flex items-center justify-center rounded
                     hover:bg-accent transition-colors"
        >
          {renderIcon(14)}
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        side="bottom"
        sideOffset={6}
        className="w-[380px] p-0 rounded-[10px]"
      >
        <KbIconPickerBody
          value={property.icon ?? null}
          color={property.iconColor ?? null}
          onChange={({ icon, color }) => onChangeIcon(icon, color)}
          onCommitClose={() => setOpen(false)}
        />
      </PopoverContent>
    </Popover>
  );
}
