"use client";

import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { KbIconPickerBody } from "@/components/knowledge/kb-icon-picker";
import { paletteText, type PaletteColor } from "@/lib/palette";
import { iconForRole } from "./role-icons";
import { cn } from "@/lib/utils";

interface IconPickerProps {
  /** Имя иконки (KB_ICONS / legacy role-icons) или null = «по умолчанию» */
  value: string | null;
  /** Цвет тинта из палитры (`@/lib/palette`). null = muted-foreground. */
  color: string | null;
  /** Системный код роли — для preview дефолтной иконки. Для новой роли передайте "". */
  roleCode: string;
  onChange: (next: { icon: string | null; color: string | null }) => void;
  disabled?: boolean;
}

/**
 * Icon picker для ролей. Триггер совпадает с прежним 40px-стилем
 * (border + chevron), но popover-content переиспользует
 * `<KbIconPickerBody>` из базы знаний: общий набор иконок (KB_ICONS),
 * палитра цветов, поиск, random, clear.
 *
 * `value` может быть как именем из KB_ICONS, так и legacy-именем из
 * `PICKABLE_ICONS` (crown / shield-alert / building / …). `iconForRole`
 * резолвит оба через расширенный `ICON_REGISTRY`.
 */
export function IconPicker({
  value,
  color,
  roleCode,
  onChange,
  disabled,
}: IconPickerProps) {
  const [open, setOpen] = useState(false);
  const CurrentIcon = iconForRole(roleCode, value);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          aria-label="Выбрать иконку"
          className={cn(
            "inline-flex items-center justify-center gap-1.5 h-10 rounded-lg border border-input bg-background px-2 transition-colors shrink-0",
            "hover:bg-accent disabled:opacity-50 disabled:cursor-not-allowed",
            "data-[state=open]:bg-accent",
          )}
        >
          <CurrentIcon
            className={cn(
              "w-4 h-4",
              paletteText(color as PaletteColor | null) || "text-foreground",
            )}
          />
          <ChevronDown className="w-3 h-3 text-muted-foreground" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        side="bottom"
        sideOffset={6}
        className="w-[380px] p-0 rounded-[10px]"
      >
        <KbIconPickerBody
          value={value}
          color={color}
          onChange={onChange}
          onCommitClose={() => setOpen(false)}
          // Роль всегда имеет fallback-иконку по `code`, поэтому tint
          // без явно выбранной иконки нужно сохранять.
          commitColorWithoutIcon
        />
      </PopoverContent>
    </Popover>
  );
}
