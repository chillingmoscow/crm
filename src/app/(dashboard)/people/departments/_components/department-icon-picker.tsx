"use client";

import { useState } from "react";
import { Boxes, ChevronDown } from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { KbIconPickerBody } from "@/components/knowledge/kb-icon-picker";
import { ICON_REGISTRY } from "../../roles/_components/role-icons";
import { paletteText, type PaletteColor } from "@/lib/palette";
import { cn } from "@/lib/utils";

interface DepartmentIconPickerProps {
  value: string | null;
  color: string | null;
  onChange: (next: { icon: string | null; color: string | null }) => void;
  disabled?: boolean;
}

export function DepartmentIconPicker({
  value,
  color,
  onChange,
  disabled,
}: DepartmentIconPickerProps) {
  const [open, setOpen] = useState(false);
  const Icon = (value && ICON_REGISTRY[value]) || Boxes;
  const tintClass = paletteText(color as PaletteColor | null);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          aria-label="Выбрать иконку"
          className={cn(
            "inline-flex items-center justify-center gap-1.5 h-10 rounded-md border border-input bg-background px-1.5 transition-colors shrink-0",
            "data-[state=open]:bg-accent",
            disabled
              ? "opacity-50 cursor-not-allowed"
              : "hover:bg-accent cursor-pointer",
          )}
        >
          <span
            className={cn(
              "flex items-center justify-center size-7 rounded-md bg-muted",
              tintClass || "text-muted-foreground",
            )}
          >
            <Icon className="w-4 h-4" />
          </span>
          <ChevronDown className="size-4 text-muted-foreground" />
        </button>
      </PopoverTrigger>
      {/* Размеры/паддинги — как в KbIconPicker (340 × p-0, радиус окна общий):
          KbIconPickerBody сам рисует внутренние paddings, добавлять
          ещё `p-3` снаружи рвёт сетку и мешает скроллу. */}
      <PopoverContent
        align="start"
        side="bottom"
        sideOffset={6}
        className="w-[340px] p-0"
      >
        <KbIconPickerBody
          value={value}
          color={color}
          onChange={onChange}
          onCommitClose={() => setOpen(false)}
          commitColorWithoutIcon
          clearLabel="Значок по умолчанию"
        />
      </PopoverContent>
    </Popover>
  );
}
